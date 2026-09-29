"""Study-area configuration. A city = one JSON file in cities/ + a data folder in data/cities/<id>/.

Adding a city is a configuration/data task: write cities/<id>.json, run prep/*.py <id>.
"""
import json, math, sys
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CITIES_DIR = ROOT / "cities"
DATA_DIR = ROOT / "data" / "cities"
DEFAULT_CITY = "mumbai"
KY = 110_570.0  # metres per degree latitude


@dataclass
class City:
    id: str
    cfg: dict
    bbox: dict = field(init=False)
    cell_m: float = field(init=False)

    def __post_init__(self):
        self.bbox = self.cfg["bbox"]
        self.cell_m = float(self.cfg["grid"]["cell_m"])
        self.lat0 = (self.bbox["south"] + self.bbox["north"]) / 2
        self.kx = 111_320.0 * math.cos(math.radians(self.lat0))  # metres per degree longitude
        self.dlat = round(self.cell_m / KY, 6)
        self.dlon = round(self.cell_m / self.kx, 6)
        self.nx = round((self.bbox["east"] - self.bbox["west"]) / self.dlon)
        self.ny = round((self.bbox["north"] - self.bbox["south"]) / self.dlat)
        self.cell_area_m2 = self.cell_m ** 2
        self.raw = DATA_DIR / self.id / "raw"
        self.proc = DATA_DIR / self.id / "processed"

    def cell_center(self, r: int, c: int):
        """Row 0 = north edge. Returns (lon, lat)."""
        return (self.bbox["west"] + (c + 0.5) * self.dlon, self.bbox["north"] - (r + 0.5) * self.dlat)

    def cell_polygon(self, r: int, c: int):
        w = self.bbox["west"] + c * self.dlon
        n = self.bbox["north"] - r * self.dlat
        e, s = w + self.dlon, n - self.dlat
        return [[round(x, 5), round(y, 5)] for x, y in ((w, n), (e, n), (e, s), (w, s), (w, n))]

    def ensure_dirs(self):
        self.raw.mkdir(parents=True, exist_ok=True); self.proc.mkdir(parents=True, exist_ok=True)


def city_index():
    return json.loads((CITIES_DIR / "index.json").read_text(encoding="utf-8"))


def get_city(city_id: str = DEFAULT_CITY) -> City:
    f = CITIES_DIR / f"{city_id}.json"
    if not f.exists():
        raise KeyError(f"study area '{city_id}' is not configured")
    return City(city_id, json.loads(f.read_text(encoding="utf-8")))


def city_from_argv() -> City:
    return get_city(sys.argv[1] if len(sys.argv) > 1 else DEFAULT_CITY)
