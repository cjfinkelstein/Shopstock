"""One-time backfill: real active projects/jobs, added 2026-07-28.

Names only were given (no customer/address split provided), so those fields
are left blank rather than guessed -- edit the Job rows in Settings/Jobs
later if you want customer or site address filled in.

Run from the api/ directory:  python scripts/import_projects_20260728.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.database import SessionLocal, Base, engine
from app.models import Job

PROJECT_NAMES = [
    "Wmata 12701 Missouri",
    "Solterra RVA",
    "Solterra Norfolk",
    "Pole Lights",
    "Parham One Richmond",
    "Mainspring Lynchburg",
    "Goldstein Addition",
    "Gluck Renovation",
    "Glen Mikvah",
    "Freedom Recovery",
    "Fire Unit",
    "Etz Chaim",
    "867 Maple Crest",
    "7630 Carla Rd",
    "71 Monnett",
    "7 Church Lane",
    "3500 Arborwood Ct",
    "3214 Timberfield Renovation",
    "204 E. Joppa Rd",
]


def main() -> None:
    Base.metadata.create_all(engine)
    db = SessionLocal()
    try:
        existing_numbers = [j.job_number for j in db.query(Job).all()]
        # follow the JOB-100x convention already in use
        nums = [int(n.split("-")[1]) for n in existing_numbers if n.startswith("JOB-")]
        next_num = (max(nums) + 1) if nums else 1001

        existing_names = {j.name for j in db.query(Job).all()}
        created = 0
        for name in PROJECT_NAMES:
            if name in existing_names:
                print(f"Skipped (already exists): {name}")
                continue
            job_number = f"JOB-{next_num}"
            db.add(Job(job_number=job_number, name=name, status="active"))
            print(f"Created {job_number}: {name}")
            next_num += 1
            created += 1
        db.commit()
        print(f"\nCreated {created} new jobs ({len(PROJECT_NAMES) - created} already existed)")
    finally:
        db.close()


if __name__ == "__main__":
    main()
