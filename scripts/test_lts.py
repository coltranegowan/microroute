"""Checks for the LTS rules. Run: python scripts/test_lts.py"""

from lts import bike_type, lts

CASES = [
    # (description, tags, expected LTS)
    ("bike path", {"highway": "cycleway"}, 1),
    ("footway with bikes allowed", {"highway": "footway", "bicycle": "yes"}, 1),
    ("campus service road", {"highway": "service"}, 1),
    ("quiet residential street", {"highway": "residential"}, 1),
    ("separated bike track on arterial", {"highway": "primary", "cycleway:right": "track"}, 1),
    ("bike lane, 2 lanes, 25 mph", {"highway": "tertiary", "maxspeed": "25 mph", "lanes": "2", "cycleway": "lane"}, 1),
    ("bike lane, 4 lanes, 35 mph", {"highway": "secondary", "maxspeed": "35 mph", "lanes": "4", "cycleway:both": "lane"}, 3),
    ("bike lane, 45 mph", {"highway": "primary", "maxspeed": "45 mph", "cycleway": "lane"}, 4),
    ("tertiary, 30 mph, no bike lane", {"highway": "tertiary"}, 2),
    ("arterial, no bike lane", {"highway": "primary", "maxspeed": "45 mph", "lanes": "6"}, 4),
    ("sharrow is mixed traffic", {"highway": "secondary", "maxspeed": "35 mph", "cycleway": "shared_lane"}, 4),
    ("one-way, 2 lanes counts as 4", {"highway": "residential", "lanes": "2", "oneway": "yes"}, 3),
    ("merged way with list tags", {"highway": ["secondary", "tertiary"], "maxspeed": ["30 mph", "40 mph"], "lanes": ["2", "4"]}, 4),
    ("km/h speed with no unit", {"highway": "residential", "maxspeed": "40"}, 1),
    ("buffered lane, 45 mph", {"highway": "primary", "maxspeed": "45 mph", "cycleway:right": "lane",
                               "cycleway:right:buffer": "yes"}, 3),
    ("buffered lane with a width, 4 lanes, 35 mph", {"highway": "secondary", "maxspeed": "35 mph", "lanes": "4",
                                                     "cycleway:both": "lane", "cycleway:both:buffer": "0.5"}, 2),
    ("buffer=no is a painted lane", {"highway": "primary", "maxspeed": "45 mph", "cycleway:right": "lane",
                                     "cycleway:right:buffer": "no"}, 4),
]

BIKE_TYPE_CASES = [
    ("bike path", {"highway": "cycleway"}, "path"),
    ("designated path", {"highway": "path", "bicycle": "designated"}, "path"),
    ("bike track on arterial", {"highway": "primary", "cycleway:right": "track"}, "path"),
    ("walkway with bikes allowed", {"highway": "footway", "bicycle": "yes"}, "shared_path"),
    ("buffered lane", {"highway": "secondary", "cycleway:both": "lane", "cycleway:both:buffer": "yes"}, "buffered"),
    ("painted lane", {"highway": "secondary", "cycleway:right": "lane", "cycleway:left": "no"}, "lane"),
    ("sharrow", {"highway": "tertiary", "cycleway": "shared_lane"}, "sharrow"),
    ("street", {"highway": "residential"}, "none"),
    ("service road", {"highway": "service"}, "none"),
]


def main():
    failures = 0
    for description, tags, expected in CASES:
        result = lts(tags)
        if result != expected:
            failures += 1
            print(f"FAIL {description}: expected LTS {expected}, got LTS {result}")
    for description, tags, expected in BIKE_TYPE_CASES:
        result = bike_type(tags)
        if result != expected:
            failures += 1
            print(f"FAIL {description}: expected {expected}, got {result}")
    total = len(CASES) + len(BIKE_TYPE_CASES)
    print(f"{total - failures}/{total} passed")
    raise SystemExit(1 if failures else 0)


if __name__ == "__main__":
    main()
