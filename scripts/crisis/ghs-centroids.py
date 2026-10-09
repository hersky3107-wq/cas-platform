"""Dump GHS-UCDB UC_centroids Mollweide x/y. Used by load-population.ts."""
import json
import sqlite3
import sys

con = sqlite3.connect(sys.argv[1])
rows = [
    {"id": str(row[0]), "x": row[1], "y": row[2]}
    for row in con.execute("SELECT ID_UC_G0, GC_UCC_LON_2025, GC_UCC_LAT_2025 FROM UC_centroids")
]
json.dump(rows, sys.stdout)
