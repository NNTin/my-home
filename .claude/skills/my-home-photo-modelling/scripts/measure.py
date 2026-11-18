#!/usr/bin/env python3
"""Measure the model from one photo: calibrate a pinhole camera, then cast pixels onto known planes.

    python3 -I measure.py SPEC.json        prints JSON (camera, height, points, projected)

Python 3 standard library only. Pixels are original image pixels (x right, y down), as on grid.sh's labels.
Plan frame as in docs/home-model.md: x east, z south, y up. Heights are above the floor the camera stands on.
Headings are degrees clockwise from plan north (-z), as in photo poses and photo requests.

SPEC (JSON):
  "image":  {"width": W, "height": H}
  "camera": one of
     {"vps": [{"px": [u, v] | "lines": L, "heading": deg}, {...}]}   two orthogonal horizontal directions:
                                                                   focal length, heading, pitch and roll
     {"vp": {"px" | "lines", "heading": deg}, "f": px | "fovH": rad} one direction plus a known focal length,
                                                                   zero roll (e.g. down a corridor)
     {"heading": deg, "pitch": deg, "fovH": rad}                   the stored pose as is (often wrong)
     where L is a list of >= 2 image lines [[u1, v1], [u2, v2]] that are parallel in the room
  "height": camera height above the floor in metres, or
  "fitHeight": {"bottom": [u, v], "top": [u, v], "size": m}         a vertical edge of known length standing on
                                                                   the floor (door frame, cabinet) fixes it
  "at": {"x": X, "z": Z}                                           optional camera plan position: adds plan
                                                                   coordinates and enables "project"
  "points": [{"name": s, "px": [u, v], "on": PLANE}]
     PLANE: "floor" | {"y": height above the floor} | {"dx": m east of the camera} | {"dz": m south of it}
            | {"x": plan x} | {"z": plan z} (these two need "at")
  "project": [{"name": s, "x": X, "y": height, "z": Z}]             model points -> pixels (needs "at")
"""

import json
import math
import sys


def norm(v):
    length = math.sqrt(sum(c * c for c in v))
    return [c / length for c in v]


def cross(a, b):
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]


def dot(a, b):
    return sum(x * y for x, y in zip(a, b))


def heading_vector(deg):
    t = math.radians(deg)
    return [math.sin(t), 0.0, -math.cos(t)]


def intersect_lines(lines):
    """Least-squares intersection of image lines, each [[u1, v1], [u2, v2]]."""
    if len(lines) < 2:
        raise ValueError("a vanishing point needs at least two lines")
    a11 = a12 = a22 = b1 = b2 = 0.0
    for (u1, v1), (u2, v2) in lines:
        n = norm([-(v2 - v1), u2 - u1])
        c = n[0] * u1 + n[1] * v1
        a11 += n[0] * n[0]
        a12 += n[0] * n[1]
        a22 += n[1] * n[1]
        b1 += n[0] * c
        b2 += n[1] * c
    det = a11 * a22 - a12 * a12
    if abs(det) < 1e-12:
        raise ValueError("the lines are parallel in the image: no finite vanishing point")
    return [(a22 * b1 - a12 * b2) / det, (a11 * b2 - a12 * b1) / det]


def vp_pixel(spec):
    return list(spec["px"]) if "px" in spec else intersect_lines(spec["lines"])


class Camera:
    """Camera axes: right, up, backward (right-handed, like the world: x east, y up, z south)."""

    def __init__(self, cx, cy, f, rotation):
        self.cx, self.cy, self.f, self.R = cx, cy, f, rotation

    @classmethod
    def from_vps(cls, cx, cy, vp1, h1, vp2, h2, f=None):
        a = (vp1[0] - cx, vp1[1] - cy)
        b = (vp2[0] - cx, vp2[1] - cy)
        if f is None:
            f2 = -(a[0] * b[0] + a[1] * b[1])
            if f2 <= 0:
                raise ValueError("vanishing points inconsistent with orthogonal directions (f^2 <= 0)")
            f = math.sqrt(f2)
        c1 = norm([a[0], -a[1], -f])
        c2 = norm([b[0], -b[1], -f])
        c2 = norm([c2[i] - dot(c1, c2) * c1[i] for i in range(3)])
        c3 = cross(c1, c2)
        w1, w2 = heading_vector(h1), heading_vector(h2)
        w3 = cross(w1, w2)
        cam, world = [c1, c2, c3], [w1, w2, w3]
        rot = [[sum(world[k][i] * cam[k][j] for k in range(3)) for j in range(3)] for i in range(3)]
        return cls(cx, cy, f, rot)

    @classmethod
    def from_vp(cls, cx, cy, vp, heading, f):
        """Zero roll: the second, orthogonal vanishing point lies on the same image row."""
        du = vp[0] - cx
        if abs(du) < 1e-3:
            du = 1e-3
        u2 = cx - (f * f + (vp[1] - cy) ** 2) / du
        return cls.from_vps(cx, cy, vp, heading, (u2, vp[1]), heading - 90 if u2 < cx else heading + 90, f)

    @classmethod
    def from_pose(cls, cx, cy, heading, pitch, fov_h):
        f = cx / math.tan(fov_h / 2)
        t, p = math.radians(heading), math.radians(pitch)
        fwd = [math.sin(t) * math.cos(p), math.sin(p), -math.cos(t) * math.cos(p)]
        right = [math.cos(t), 0.0, math.sin(t)]
        up = cross(right, fwd)
        back = [-c for c in fwd]
        rot = [[right[i], up[i], back[i]] for i in range(3)]
        return cls(cx, cy, f, rot)

    def ray(self, u, v):
        c = [u - self.cx, -(v - self.cy), -self.f]
        return [sum(self.R[i][j] * c[j] for j in range(3)) for i in range(3)]

    def pixel(self, d):
        c = [sum(self.R[j][i] * d[j] for j in range(3)) for i in range(3)]
        if c[2] >= 0:
            return None  # behind the camera
        s = -self.f / c[2]
        return [self.cx + c[0] * s, self.cy - c[1] * s]

    def info(self):
        fwd = norm(self.ray(self.cx, self.cy))
        right = [self.R[i][0] for i in range(3)]  # the camera's x axis in the world; roll > 0: right side up
        roll = math.degrees(math.asin(max(-1.0, min(1.0, right[1]))))
        return {
            "f": round(self.f, 1),
            "fovHdeg": round(math.degrees(2 * math.atan(self.cx / self.f)), 2),
            "fovHrad": round(2 * math.atan(self.cx / self.f), 4),
            "heading": round(math.degrees(math.atan2(fwd[0], -fwd[2])) % 360, 2),
            "pitch": round(math.degrees(math.asin(fwd[1])), 2),
            "roll": round(roll, 2),
        }


def cast(cam, px, plane, h, at):
    """Where the pixel's ray meets the plane: offsets from the camera (dx east, dz south, height above floor)."""
    d = cam.ray(*px)
    if plane == "floor":
        plane = {"y": 0.0}
    if "x" in plane or "z" in plane:
        if at is None:
            raise ValueError('planes "x"/"z" need the camera position "at"')
        plane = {"dx": plane["x"] - at["x"]} if "x" in plane else {"dz": plane["z"] - at["z"]}
    if "y" in plane:
        axis, value = 1, plane["y"] - h
    elif "dx" in plane:
        axis, value = 0, plane["dx"]
    elif "dz" in plane:
        axis, value = 2, plane["dz"]
    else:
        raise ValueError(f"unknown plane {plane!r}")
    if abs(d[axis]) < 1e-12:
        raise ValueError("the ray is parallel to the plane")
    t = value / d[axis]
    if t <= 0:
        raise ValueError("the plane is behind the camera along this ray")
    return d[0] * t, d[1] * t + h, d[2] * t


def build_camera(spec):
    w, h = spec["image"]["width"], spec["image"]["height"]
    cx, cy = w / 2, h / 2
    c = spec["camera"]
    if "vps" in c:
        (a, b) = c["vps"]
        return Camera.from_vps(cx, cy, vp_pixel(a), a["heading"], vp_pixel(b), b["heading"], c.get("f"))
    if "vp" in c:
        f = c["f"] if "f" in c else cx / math.tan(c["fovH"] / 2)
        return Camera.from_vp(cx, cy, vp_pixel(c["vp"]), c["vp"]["heading"], f)
    return Camera.from_pose(cx, cy, c["heading"], c["pitch"], c["fovH"])


def fit_height(cam, fit):
    """Camera height that makes the vertical edge bottom->top exactly fit["size"] long."""
    d = cam.ray(*fit["bottom"])
    t = -1.0 / d[1]
    dx, dz = d[0] * t, d[2] * t
    top = cam.ray(*fit["top"])
    s = math.hypot(dx, dz) / math.hypot(top[0], top[2])
    return fit["size"] / (1.0 + top[1] * s)


def run(spec):
    cam = build_camera(spec)
    out = {"camera": cam.info()}
    if "vps" in spec["camera"] or "vp" in spec["camera"]:
        vps = spec["camera"]["vps"] if "vps" in spec["camera"] else [spec["camera"]["vp"]]
        out["camera"]["vps"] = [[round(c, 1) for c in vp_pixel(v)] for v in vps]
    h = fit_height(cam, spec["fitHeight"]) if "fitHeight" in spec else spec.get("height")
    at = spec.get("at")
    if h is not None:
        out["height"] = round(h, 3)
    points = []
    for p in spec.get("points", []):
        if h is None:
            raise ValueError('points need "height" or "fitHeight"')
        try:
            dx, y, dz = cast(cam, p["px"], p.get("on", "floor"), h, at)
        except ValueError as e:
            points.append({"name": p.get("name"), "error": str(e)})
            continue
        r = {"name": p.get("name"), "dx": round(dx, 3), "dz": round(dz, 3), "height": round(y, 3),
             "distance": round(math.hypot(dx, dz), 3)}
        if at is not None:
            r["x"], r["z"] = round(at["x"] + dx, 3), round(at["z"] + dz, 3)
        points.append(r)
    if points:
        out["points"] = points
    projected = []
    for p in spec.get("project", []):
        if at is None or h is None:
            raise ValueError('"project" needs "at" and a height')
        px = cam.pixel([p["x"] - at["x"], p["y"] - h, p["z"] - at["z"]])
        projected.append({"name": p.get("name"), "px": None if px is None else [round(c, 1) for c in px]})
    if projected:
        out["projected"] = projected
    return out


def main(argv):
    if len(argv) != 2 or argv[1] in ("-h", "--help"):
        print(__doc__, file=sys.stderr)
        return 2
    with open(argv[1], encoding="utf-8") as fh:
        spec = json.load(fh)
    try:
        print(json.dumps(run(spec), indent=2))
    except (KeyError, ValueError) as e:
        print(f"measure.py: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
