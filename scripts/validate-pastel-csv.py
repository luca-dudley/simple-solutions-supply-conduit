#!/usr/bin/env python3
"""
validate-pastel-csv.py
Sanity checks an exported CSV file against Sage Pastel Partner/Evolution column specification.
"""

import sys
import csv
from pathlib import Path

REQUIRED_COLUMNS = [
    "RecordType",
    "DocumentNumber",
    "Date",
    "SupplierCode",
    "ItemCode",
    "Description",
    "Quantity",
    "UnitPrice",
    "TaxCode",
]


def validate_csv(file_path: str) -> bool:
    path = Path(file_path)
    if not path.exists():
        print(f"❌ Error: File not found at '{file_path}'")
        return False

    with open(path, mode="r", encoding="utf-8") as f:
        reader = csv.reader(f)
        try:
            header = next(reader)
        except StopIteration:
            print("❌ Error: CSV file is empty.")
            return False

        # Validate header columns
        if header != REQUIRED_COLUMNS:
            print("❌ Header mismatch!")
            print(f"Expected: {REQUIRED_COLUMNS}")
            print(f"Got:      {header}")
            return False

        row_count = 0
        errors = 0
        for i, row in enumerate(reader, start=2):
            row_count += 1
            if len(row) != len(REQUIRED_COLUMNS):
                print(f"❌ Line {i}: Column count {len(row)} does not match {len(REQUIRED_COLUMNS)}")
                errors += 1
                continue

            record_type, doc_num, date_str, supp_code, item_code, desc, qty, unit_price, tax = row

            if record_type not in ["HEADER", "DETAIL"]:
                print(f"❌ Line {i}: Invalid RecordType '{record_type}'. Must be HEADER or DETAIL.")
                errors += 1

            try:
                float(qty)
            except ValueError:
                print(f"❌ Line {i}: Quantity '{qty}' is not numeric.")
                errors += 1

            try:
                float(unit_price)
            except ValueError:
                print(f"❌ Line {i}: UnitPrice '{unit_price}' is not numeric.")
                errors += 1

    if errors == 0:
        print(f"✅ SUCCESS: CSV '{file_path}' ({row_count} lines) conforms to Sage Pastel specs.")
        return True
    else:
        print(f"❌ Validation failed with {errors} errors.")
        return False


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python validate-pastel-csv.py <path_to_csv>")
        sys.exit(1)

    success = validate_csv(sys.argv[1])
    sys.exit(0 if success else 1)
