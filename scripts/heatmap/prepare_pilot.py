#!/usr/bin/env python3
"""Build the Črna na Koroškem Heatmap Pilot V1 habitat artifact.

The script reads only the pilot AOI from the official ESA WorldCover 2021 v200
Cloud-Optimized GeoTIFFs. It never writes the source rasters to the repository.
"""

from __future__ import annotations

import argparse
import json
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import rasterio
from pyproj import Transformer
from rasterio.windows import from_bounds


PILOT_CENTER = (46.47045, 14.85009)  # Open-Meteo geocoder, verified 2026-09-21.
PILOT_RADIUS_M = 25_000
HABITAT_CELL_SIZE_M = 1_000
WEATHER_SPACING_M = 10_000
WORLD_COVER_TREE_CODE = 10
WORLD_COVER_GRASSLAND_CODE = 30
WORLD_COVER_NODATA = 0
WORLD_COVER_URLS = (
    "https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_N45E012_Map.tif",
    "https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_N45E015_Map.tif",
)


@dataclass
class RasterSubset:
    data: np.ndarray
    transform: Any
    bounds: tuple[float, float, float, float]


def projected_grid(center_x: float, center_y: float, radius_m: float, cell_m: float):
    extent = math.ceil(radius_m / cell_m)
    for row in range(-extent, extent + 1):
        for column in range(-extent, extent + 1):
            center_cell_x = center_x + column * cell_m
            center_cell_y = center_y + row * cell_m
            if math.hypot(center_cell_x - center_x, center_cell_y - center_y) <= radius_m:
                half = cell_m / 2
                yield row, column, center_cell_x, center_cell_y, (
                    center_cell_x - half,
                    center_cell_y - half,
                    center_cell_x + half,
                    center_cell_y + half,
                )


def read_worldcover_subsets(aoi_bounds: tuple[float, float, float, float]) -> list[RasterSubset]:
    subsets: list[RasterSubset] = []
    for url in WORLD_COVER_URLS:
        with rasterio.open(url) as dataset:
            left = max(aoi_bounds[0], dataset.bounds.left)
            bottom = max(aoi_bounds[1], dataset.bounds.bottom)
            right = min(aoi_bounds[2], dataset.bounds.right)
            top = min(aoi_bounds[3], dataset.bounds.top)
            if left >= right or bottom >= top:
                continue
            window = from_bounds(left, bottom, right, top, dataset.transform).round_offsets().round_lengths()
            data = dataset.read(1, window=window)
            transform = dataset.window_transform(window)
            bounds = rasterio.windows.bounds(window, dataset.transform)
            subsets.append(RasterSubset(data=data, transform=transform, bounds=bounds))
    if not subsets:
        raise RuntimeError("Pilot AOI does not intersect the configured WorldCover tiles.")
    return subsets


def cell_fractions(
    projected_bounds: tuple[float, float, float, float],
    wgs_bounds: tuple[float, float, float, float],
    subsets: list[RasterSubset],
    to_projected: Transformer,
) -> tuple[float, float, int]:
    tree_pixels = 0
    grass_pixels = 0
    valid_pixels = 0
    x_min, y_min, x_max, y_max = projected_bounds
    for subset in subsets:
        left = max(wgs_bounds[0], subset.bounds[0])
        bottom = max(wgs_bounds[1], subset.bounds[1])
        right = min(wgs_bounds[2], subset.bounds[2])
        top = min(wgs_bounds[3], subset.bounds[3])
        if left >= right or bottom >= top:
            continue

        transform = subset.transform
        col0 = max(0, int(math.floor((left - transform.c) / transform.a)))
        col1 = min(subset.data.shape[1], int(math.ceil((right - transform.c) / transform.a)))
        row0 = max(0, int(math.floor((transform.f - top) / -transform.e)))
        row1 = min(subset.data.shape[0], int(math.ceil((transform.f - bottom) / -transform.e)))
        if col0 >= col1 or row0 >= row1:
            continue

        values = subset.data[row0:row1, col0:col1]
        columns = np.arange(col0, col1, dtype=np.float64) + 0.5
        rows = np.arange(row0, row1, dtype=np.float64) + 0.5
        longitudes = transform.c + columns * transform.a
        latitudes = transform.f + rows * transform.e
        longitude_grid, latitude_grid = np.meshgrid(longitudes, latitudes)
        xs, ys = to_projected.transform(longitude_grid, latitude_grid)
        inside = (xs >= x_min) & (xs < x_max) & (ys >= y_min) & (ys < y_max)
        valid = inside & (values != WORLD_COVER_NODATA)
        valid_pixels += int(np.count_nonzero(valid))
        tree_pixels += int(np.count_nonzero(valid & (values == WORLD_COVER_TREE_CODE)))
        grass_pixels += int(np.count_nonzero(valid & (values == WORLD_COVER_GRASSLAND_CODE)))

    if valid_pixels == 0:
        return 0.0, 0.0, 0
    return tree_pixels / valid_pixels, grass_pixels / valid_pixels, valid_pixels


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", default="src/data/heatmapPilot")
    args = parser.parse_args()

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    to_projected = Transformer.from_crs("EPSG:4326", "EPSG:3035", always_xy=True)
    to_wgs = Transformer.from_crs("EPSG:3035", "EPSG:4326", always_xy=True)
    center_latitude, center_longitude = PILOT_CENTER
    center_x, center_y = to_projected.transform(center_longitude, center_latitude)

    habitat_cells = list(projected_grid(center_x, center_y, PILOT_RADIUS_M, HABITAT_CELL_SIZE_M))
    all_corners = []
    for _, _, _, _, bounds in habitat_cells:
        x_min, y_min, x_max, y_max = bounds
        all_corners.extend(to_wgs.transform(x, y) for x, y in (
            (x_min, y_min), (x_max, y_min), (x_max, y_max), (x_min, y_max)
        ))
    aoi_bounds = (
        min(point[0] for point in all_corners),
        min(point[1] for point in all_corners),
        max(point[0] for point in all_corners),
        max(point[1] for point in all_corners),
    )
    subsets = read_worldcover_subsets(aoi_bounds)

    weather_offsets = range(-2, 3)
    weather_cells = []
    for row in weather_offsets:
        for column in weather_offsets:
            x = center_x + column * WEATHER_SPACING_M
            y = center_y + row * WEATHER_SPACING_M
            longitude, latitude = to_wgs.transform(x, y)
            weather_cells.append({
                "id": f"weather-{row + 2}-{column + 2}",
                "latitude": round(latitude, 6),
                "longitude": round(longitude, 6),
                "projectedX": round(x, 2),
                "projectedY": round(y, 2),
            })

    features = []
    for index, (row, column, cell_x, cell_y, projected_bounds) in enumerate(habitat_cells):
        x_min, y_min, x_max, y_max = projected_bounds
        corners = [to_wgs.transform(x, y) for x, y in (
            (x_min, y_min), (x_max, y_min), (x_max, y_max), (x_min, y_max), (x_min, y_min)
        )]
        wgs_bounds = (
            min(point[0] for point in corners),
            min(point[1] for point in corners),
            max(point[0] for point in corners),
            max(point[1] for point in corners),
        )
        tree_fraction, grass_fraction, source_pixels = cell_fractions(
            projected_bounds, wgs_bounds, subsets, to_projected
        )
        nearest_weather = min(
            weather_cells,
            key=lambda weather: (weather["projectedX"] - cell_x) ** 2 + (weather["projectedY"] - cell_y) ** 2,
        )
        center_longitude_cell, center_latitude_cell = to_wgs.transform(cell_x, cell_y)
        area_id = f"area-{row + 25:02d}-{column + 25:02d}"
        features.append({
            "type": "Feature",
            "id": area_id,
            "properties": {
                "id": area_id,
                "weatherCellId": nearest_weather["id"],
                "centerLatitude": round(center_latitude_cell, 6),
                "centerLongitude": round(center_longitude_cell, 6),
                "treeCoverFraction": round(tree_fraction, 4),
                "grasslandFraction": round(grass_fraction, 4),
                "sourcePixelCount": source_pixels,
                "sourceVersion": "ESA WorldCover 2021 v200",
                "sourceResolutionM": 10,
            },
            "geometry": {"type": "Polygon", "coordinates": [[
                [round(longitude, 6), round(latitude, 6)] for longitude, latitude in corners
            ]]},
        })
        if (index + 1) % 250 == 0:
            print(f"Processed {index + 1}/{len(habitat_cells)} habitat cells")

    geojson = {"type": "FeatureCollection", "features": features}
    metadata = {
        "schemaVersion": 1,
        "pilotId": "crna-koroska-v1",
        "label": "Črna na Koroškem · Heatmap Pilot V1",
        "center": {"latitude": center_latitude, "longitude": center_longitude, "source": "Open-Meteo Geocoding API"},
        "radiusM": PILOT_RADIUS_M,
        "bbox": [round(value, 6) for value in aoi_bounds],
        "habitatCellSizeM": HABITAT_CELL_SIZE_M,
        "habitatPolygonCount": len(features),
        "weatherSamplingSpacingM": WEATHER_SPACING_M,
        "weatherCellCount": len(weather_cells),
        "weatherCells": weather_cells,
        "worldCover": {
            "dataset": "ESA WorldCover",
            "version": "2021 v200",
            "resolutionM": 10,
            "crs": "EPSG:4326",
            "classCodes": {"treeCover": WORLD_COVER_TREE_CODE, "grassland": WORLD_COVER_GRASSLAND_CODE},
            "license": "CC BY 4.0",
            "attribution": "© ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium",
            "sourceUrls": list(WORLD_COVER_URLS),
        },
        "generatedBy": "scripts/heatmap/prepare_pilot.py",
    }

    (output_dir / "habitat.geojson.json").write_text(
        json.dumps(geojson, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )
    (output_dir / "metadata.json").write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps({
        "habitatPolygonCount": len(features),
        "weatherCellCount": len(weather_cells),
        "bbox": metadata["bbox"],
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
