"""Helpers for Bambu AMS tray codes stored as printer params."""

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.printer_params import FilamentPrinterParam, SpoolPrinterParam
from app.models.spool import Spool


async def clear_bambu_idx_for_filament(db: AsyncSession, filament_id: int) -> int:
    """Delete filament- and spool-level ``bambu_idx`` for *filament_id*.

    Used when a filament's material type changes (PLA → PETG) so a leftover
    SUN20xxx / GFL / GFA tray code cannot be assigned to the new family.
    """
    fil_result = await db.execute(
        delete(FilamentPrinterParam).where(
            FilamentPrinterParam.filament_id == filament_id,
            FilamentPrinterParam.param_key == "bambu_idx",
        )
    )
    spool_ids = (
        await db.execute(select(Spool.id).where(Spool.filament_id == filament_id))
    ).scalars().all()
    spool_count = 0
    if spool_ids:
        spool_result = await db.execute(
            delete(SpoolPrinterParam).where(
                SpoolPrinterParam.spool_id.in_(spool_ids),
                SpoolPrinterParam.param_key == "bambu_idx",
            )
        )
        spool_count = spool_result.rowcount or 0
    return (fil_result.rowcount or 0) + spool_count
