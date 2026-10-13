import pytest
import pytest_asyncio
from sqlalchemy import select

from app.models import Filament, Manufacturer, Printer, Spool, SpoolStatus
from app.models.printer import PrinterSlot, PrinterSlotAssignment
from app.plugins.manager import PluginManager


@pytest_asyncio.fixture
async def slots_env(db_session, monkeypatch):
    """Point the plugin manager at the test session and seed a printer + two spools."""

    class _SessionContext:
        async def __aenter__(self):
            return db_session

        async def __aexit__(self, *args):
            pass

    monkeypatch.setattr(
        "app.plugins.manager.async_session_maker", lambda: _SessionContext()
    )

    printer = Printer(name="Voron 2T", driver_key="moonraker_filaman")
    db_session.add(printer)
    await db_session.commit()
    await db_session.refresh(printer)

    manufacturer = Manufacturer(name="Test Manufacturer")
    db_session.add(manufacturer)
    await db_session.commit()
    await db_session.refresh(manufacturer)

    status = (
        await db_session.execute(select(SpoolStatus).where(SpoolStatus.key == "active"))
    ).scalar_one()

    spools = []
    for designation, material in (("Red PLA", "PLA"), ("Blue PETG", "PETG")):
        filament = Filament(
            manufacturer_id=manufacturer.id,
            designation=designation,
            material_type=material,
            diameter_mm=1.75,
            default_spool_weight_g=250.0,
        )
        db_session.add(filament)
        await db_session.commit()
        await db_session.refresh(filament)

        spool = Spool(
            filament_id=filament.id,
            status_id=status.id,
            initial_total_weight_g=1000.0,
            empty_spool_weight_g=250.0,
            remaining_weight_g=750.0,
        )
        db_session.add(spool)
        await db_session.commit()
        await db_session.refresh(spool)
        spools.append(spool)

    return printer, spools


def _toolhead(slot_index: str, name: str, **extra) -> dict:
    return {
        "slot_index": slot_index,
        "slot_name": name,
        "slot_kind": "toolhead",
        "present": False,
        **extra,
    }


def _tray(slot_index: str, name: str, **extra) -> dict:
    return {
        "slot_index": slot_index,
        "slot_name": name,
        "slot_kind": "tray",
        "present": False,
        **extra,
    }


async def _assignments_by_slot_index(db_session, printer_id: int) -> dict[str, int | None]:
    result = await db_session.execute(
        select(PrinterSlot, PrinterSlotAssignment)
        .join(PrinterSlotAssignment, PrinterSlotAssignment.slot_id == PrinterSlot.id)
        .where(PrinterSlot.printer_id == printer_id)
    )
    return {
        (slot.custom_fields or {}).get("slot_index"): assignment.spool_id
        for slot, assignment in result.all()
    }


class TestPerSlotSpoolAssignment:
    @pytest.mark.asyncio
    async def test_spool_lands_on_reporting_toolhead(self, db_session, slots_env):
        """A spool reported for toolhead 2 must not be recorded on toolhead 1."""
        printer, spools = slots_env
        manager = PluginManager()

        await manager._handle_slots_update(
            printer.id,
            [
                _toolhead("0-0", "Toolhead 1", spool_id=None),
                _toolhead("0-1", "Toolhead 2", spool_id=spools[1].id, present=True),
            ],
        )

        assignments = await _assignments_by_slot_index(db_session, printer.id)
        assert assignments["0-1"] == spools[1].id
        assert assignments["0-0"] is None

    @pytest.mark.asyncio
    async def test_per_slot_report_overrides_printer_wide_active_spool(
        self, db_session, slots_env
    ):
        """The printer-wide active spool must not pull the assignment onto slot 0-0."""
        printer, spools = slots_env
        manager = PluginManager()

        await manager._handle_slots_update(
            printer.id,
            [
                _toolhead("0-0", "Toolhead 1", spool_id=None),
                _toolhead("0-1", "Toolhead 2", spool_id=spools[1].id, present=True),
            ],
            active_spool_id_raw=spools[1].id,
        )

        assignments = await _assignments_by_slot_index(db_session, printer.id)
        assert assignments["0-1"] == spools[1].id
        assert assignments["0-0"] is None

    @pytest.mark.asyncio
    async def test_moving_spool_between_toolheads_clears_the_old_one(
        self, db_session, slots_env
    ):
        printer, spools = slots_env
        manager = PluginManager()

        await manager._handle_slots_update(
            printer.id,
            [
                _toolhead("0-0", "Toolhead 1", spool_id=spools[0].id, present=True),
                _toolhead("0-1", "Toolhead 2", spool_id=None),
            ],
        )
        await manager._handle_slots_update(
            printer.id,
            [
                _toolhead("0-0", "Toolhead 1", spool_id=None),
                _toolhead("0-1", "Toolhead 2", spool_id=spools[0].id, present=True),
            ],
        )

        assignments = await _assignments_by_slot_index(db_session, printer.id)
        assert assignments["0-1"] == spools[0].id
        assert assignments["0-0"] is None

    @pytest.mark.asyncio
    async def test_loaded_bay_without_spool_id_keeps_the_stored_link(
        self, db_session, slots_env
    ):
        """A restart reports spool_id null while filament is still in the bay.

        Bambuddy's sticky map lives in memory, so the first slots_update after
        startup has no spool id. That must not unlink the spool AMS View uses
        for brand and remaining weight.
        """
        printer, spools = slots_env
        manager = PluginManager()

        await manager._handle_slots_update(
            printer.id,
            [_tray("0-0", "AMS 1 - Slot 1", spool_id=spools[0].id, present=True)],
        )
        await manager._handle_slots_update(
            printer.id,
            [
                _tray(
                    "0-0",
                    "AMS 1 - Slot 1",
                    spool_id=None,
                    present=True,
                    tray_type="PLA",
                    tray_color="FF0000FF",
                )
            ],
        )

        assignments = await _assignments_by_slot_index(db_session, printer.id)
        assert assignments["0-0"] == spools[0].id

    @pytest.mark.asyncio
    async def test_loaded_bay_with_different_material_drops_the_stored_link(
        self, db_session, slots_env
    ):
        """A swap has no spool id either, but the tray is no longer that spool."""
        printer, spools = slots_env
        manager = PluginManager()

        await manager._handle_slots_update(
            printer.id,
            [_tray("0-0", "AMS 1 - Slot 1", spool_id=spools[0].id, present=True)],
        )
        await manager._handle_slots_update(
            printer.id,
            [_tray("0-0", "AMS 1 - Slot 1", spool_id=None, present=True, tray_type="PETG")],
        )

        assignments = await _assignments_by_slot_index(db_session, printer.id)
        assert assignments["0-0"] is None

    @pytest.mark.asyncio
    async def test_loaded_unlinked_bay_keeps_the_printer_profile(
        self, db_session, slots_env
    ):
        """A new printer has AMS profiles and no FilaMan spool links yet.

        The tray code, material, and color still have to show. Marking the
        bay empty because spool_id is null hides them on the printer page.
        """
        printer, _spools = slots_env
        manager = PluginManager()

        await manager._handle_slots_update(
            printer.id,
            [
                _tray(
                    "0-0",
                    "AMS 1 - Slot 1",
                    spool_id=None,
                    present=True,
                    tray_type="PLA",
                    tray_color="46792AFF",
                    tray_info_idx="SUN20007",
                )
            ],
        )

        result = await db_session.execute(
            select(PrinterSlotAssignment)
            .join(PrinterSlot, PrinterSlot.id == PrinterSlotAssignment.slot_id)
            .where(PrinterSlot.printer_id == printer.id)
        )
        assignment = result.scalar_one()
        assert assignment.spool_id is None
        assert assignment.present is True
        assert assignment.meta["tray_type"] == "PLA"
        assert assignment.meta["tray_color"] == "46792AFF"
        assert assignment.meta["tray_info_idx"] == "SUN20007"

    @pytest.mark.asyncio
    async def test_empty_bay_still_clears_its_spool(self, db_session, slots_env):
        printer, spools = slots_env
        manager = PluginManager()

        await manager._handle_slots_update(
            printer.id,
            [_tray("0-0", "AMS 1 - Slot 1", spool_id=spools[0].id, present=True)],
        )
        await manager._handle_slots_update(
            printer.id,
            [_tray("0-0", "AMS 1 - Slot 1", spool_id=None, present=False)],
        )

        assignments = await _assignments_by_slot_index(db_session, printer.id)
        assert assignments["0-0"] is None

    @pytest.mark.asyncio
    async def test_single_toolhead_driver_still_uses_active_spool_fallback(
        self, db_session, slots_env
    ):
        """Drivers that report no per-slot spool keep the previous behaviour."""
        printer, spools = slots_env
        manager = PluginManager()

        await manager._handle_slots_update(
            printer.id,
            [_toolhead("0-0", "Toolhead 1")],
            active_spool_id_raw=spools[0].id,
        )

        assignments = await _assignments_by_slot_index(db_session, printer.id)
        assert assignments["0-0"] == spools[0].id

    @pytest.mark.asyncio
    async def test_single_slot_fallback_also_works_without_slot_data(
        self, db_session, slots_env
    ):
        """The refresh path passes no slots; on a single-slot printer it still syncs."""
        printer, spools = slots_env
        manager = PluginManager()

        await manager._handle_slots_update(printer.id, [_toolhead("0-0", "Toolhead 1")])
        await manager._handle_slots_update(
            printer.id, [], None, spools[0].id
        )

        assignments = await _assignments_by_slot_index(db_session, printer.id)
        assert assignments["0-0"] == spools[0].id


class TestActiveSpoolFallbackOnMultiSlotPrinters:
    """Regression cover for #127.

    driver_health(?refresh=1) and driver startup call _handle_slots_update with an
    empty slot list, so per_slot_spools stays False there no matter what the driver
    reports. On a tray printer the fallback then stamped the active spool into 0-0
    on every poll, overwriting the real map.
    """

    async def _seed_tray_map(self, manager, printer, spools):
        await manager._handle_slots_update(
            printer.id,
            [
                _tray("0-0", "Tray 1", spool_id=spools[0].id, present=True),
                _tray("0-1", "Tray 2", spool_id=spools[1].id, present=True),
                _tray("0-2", "Tray 3", spool_id=None),
                _tray("0-3", "Tray 4", spool_id=None),
            ],
        )

    @pytest.mark.asyncio
    async def test_refresh_path_leaves_the_tray_map_alone(self, db_session, slots_env):
        printer, spools = slots_env
        manager = PluginManager()
        await self._seed_tray_map(manager, printer, spools)

        # Exactly what api/v1/printers.py::driver_health does on ?refresh=1:
        # the spool loaded in the toolhead sits in tray 1, not tray 0.
        await manager._handle_slots_update(printer.id, [], None, spools[1].id)

        assignments = await _assignments_by_slot_index(db_session, printer.id)
        assert assignments["0-0"] == spools[0].id
        assert assignments["0-1"] == spools[1].id
        assert assignments["0-2"] is None
        assert assignments["0-3"] is None

    @pytest.mark.asyncio
    async def test_repeated_polls_do_not_drift(self, db_session, slots_env):
        """The UI polls every few seconds, so the skip has to hold indefinitely."""
        printer, spools = slots_env
        manager = PluginManager()
        await self._seed_tray_map(manager, printer, spools)

        for _ in range(5):
            await manager._handle_slots_update(printer.id, [], None, spools[1].id)

        assignments = await _assignments_by_slot_index(db_session, printer.id)
        assert assignments["0-0"] == spools[0].id
        assert assignments["0-1"] == spools[1].id

    @pytest.mark.asyncio
    async def test_unassigned_multi_slot_printer_is_not_stamped_either(
        self, db_session, slots_env
    ):
        """Drivers that report no spool_id at all must not get slot 0-0 filled in."""
        printer, spools = slots_env
        manager = PluginManager()

        await manager._handle_slots_update(
            printer.id,
            [_tray("0-0", "Tray 1"), _tray("0-1", "Tray 2")],
            None,
            spools[0].id,
        )

        assignments = await _assignments_by_slot_index(db_session, printer.id)
        assert assignments["0-0"] is None
        assert assignments["0-1"] is None


def test_tray_contradiction_ignores_alpha_and_material_suffix():
    conflict = PluginManager._tray_contradicts_stored
    assert conflict({"tray_type": "PLA", "tray_color": "FF0000FF"}, {"tray_type": "PLA", "tray_color": "FF0000"}) is False
    assert conflict({"tray_type": "PLA-CF", "tray_color": "112233"}, {"tray_type": "PLA", "tray_color": "112233FF"}) is False
    assert conflict({"tray_type": ""}, {"tray_type": "PLA", "tray_color": "FF0000"}) is False
    assert conflict({"tray_type": "PETG"}, {"tray_type": "PLA"}) is True
    assert conflict({"tray_type": "PLA", "tray_color": "00FF00"}, {"tray_type": "PLA", "tray_color": "FF0000"}) is True


def _ams_info(*unit_ids: int) -> dict:
    return {"ams_units": [{"ams_id": unit_id} for unit_id in unit_ids]}


async def _active_by_slot_index(db_session, printer_id: int) -> dict[str, bool]:
    result = await db_session.execute(
        select(PrinterSlot).where(PrinterSlot.printer_id == printer_id)
    )
    return {
        (slot.custom_fields or {}).get("slot_index"): bool(slot.is_active)
        for slot in result.scalars().all()
    }


class TestDisappearedAmsUnits:
    """An unplugged AMS-HT stays out of the Display API only if its row is inactive."""

    async def _seed(self, manager, printer):
        await manager._handle_slots_update(
            printer.id,
            [
                _tray("0-0", "AMS 1 - Slot 1"),
                _tray("0-1", "AMS 1 - Slot 2"),
                _tray("128-0", "AMS 129 - Slot 1"),
                _tray("255-0", "External 1"),
            ],
            _ams_info(0, 128),
        )

    @pytest.mark.asyncio
    async def test_missing_ht_unit_is_deactivated(self, db_session, slots_env):
        printer, _spools = slots_env
        manager = PluginManager()
        await self._seed(manager, printer)

        await manager._handle_slots_update(
            printer.id,
            [
                _tray("0-0", "AMS 1 - Slot 1"),
                _tray("0-1", "AMS 1 - Slot 2"),
                _tray("255-0", "External 1"),
            ],
            _ams_info(0),
        )

        active = await _active_by_slot_index(db_session, printer.id)
        assert active["128-0"] is False
        assert active["0-0"] is True
        assert active["0-1"] is True
        assert active["255-0"] is True

    @pytest.mark.asyncio
    async def test_empty_refresh_does_not_deactivate(self, db_session, slots_env):
        printer, spools = slots_env
        manager = PluginManager()
        await self._seed(manager, printer)

        await manager._handle_slots_update(printer.id, [], None, spools[0].id)

        active = await _active_by_slot_index(db_session, printer.id)
        assert active["128-0"] is True
        assert active["0-0"] is True

    @pytest.mark.asyncio
    async def test_update_without_unit_list_leaves_bays_active(
        self, db_session, slots_env
    ):
        """Moonraker-style updates do not carry ams_units and must not retire bays."""
        printer, _spools = slots_env
        manager = PluginManager()
        await self._seed(manager, printer)

        await manager._handle_slots_update(
            printer.id,
            [_tray("0-0", "AMS 1 - Slot 1")],
        )

        active = await _active_by_slot_index(db_session, printer.id)
        assert active["128-0"] is True
        assert active["0-1"] is True

    @pytest.mark.asyncio
    async def test_replugged_ht_is_reactivated(self, db_session, slots_env):
        printer, _spools = slots_env
        manager = PluginManager()
        await self._seed(manager, printer)
        await manager._handle_slots_update(
            printer.id,
            [_tray("0-0", "AMS 1 - Slot 1"), _tray("255-0", "External 1")],
            _ams_info(0),
        )

        await manager._handle_slots_update(
            printer.id,
            [
                _tray("0-0", "AMS 1 - Slot 1"),
                _tray("128-0", "AMS 129 - Slot 1"),
                _tray("255-0", "External 1"),
            ],
            _ams_info(0, 128),
        )

        active = await _active_by_slot_index(db_session, printer.id)
        assert active["128-0"] is True

    @pytest.mark.asyncio
    async def test_last_ams_unplugged_while_external_remains(
        self, db_session, slots_env
    ):
        printer, _spools = slots_env
        manager = PluginManager()
        await manager._handle_slots_update(
            printer.id,
            [_tray("128-0", "AMS 129 - Slot 1"), _tray("255-0", "External 1")],
            _ams_info(128),
        )

        await manager._handle_slots_update(
            printer.id,
            [_tray("255-0", "External 1")],
            _ams_info(),
        )

        active = await _active_by_slot_index(db_session, printer.id)
        assert active["128-0"] is False
        assert active["255-0"] is True

    @pytest.mark.asyncio
    async def test_legacy_external_key_is_still_retired(self, db_session, slots_env):
        printer, _spools = slots_env
        manager = PluginManager()
        db_session.add(
            PrinterSlot(
                printer_id=printer.id,
                slot_no=1254,
                name="External legacy",
                is_active=True,
                custom_fields={"slot_index": "255-254"},
            )
        )
        await db_session.commit()

        await manager._handle_slots_update(
            printer.id,
            [_tray("0-0", "AMS 1 - Slot 1"), _tray("255-0", "External 1")],
            _ams_info(0),
        )

        active = await _active_by_slot_index(db_session, printer.id)
        assert active["255-254"] is False
        assert active["255-0"] is True
        assert active["0-0"] is True
