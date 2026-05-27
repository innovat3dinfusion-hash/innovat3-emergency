#!/usr/bin/env python3
"""
Innovat3 QR Code Generator
URL → QR preview → Export as SVG or 3MF (25 × 25 mm, 2-colour)

Install:  pip install qrcode
Run:      python qr_generator.py
"""

import tkinter as tk
from tkinter import ttk, filedialog, messagebox
import qrcode
import os, io, re, zipfile

# ─── Defaults ─────────────────────────────────────────────────────────────────
SIZE_MM    = 25.0
THICK_MM   = 2.0
QUIET_MOD  = 2
PREVIEW_PX = 300

EC_MAP = {
    "L  –  7% recovery":  qrcode.constants.ERROR_CORRECT_L,
    "M  – 15% recovery":  qrcode.constants.ERROR_CORRECT_M,
    "Q  – 25% recovery":  qrcode.constants.ERROR_CORRECT_Q,
    "H  – 30% recovery":  qrcode.constants.ERROR_CORRECT_H,
}


# ─── QR matrix ────────────────────────────────────────────────────────────────

def make_matrix(url: str, ec) -> list:
    qr = qrcode.QRCode(version=None, error_correction=ec, box_size=1, border=0)
    qr.add_data(url)
    qr.make(fit=True)
    return qr.modules


# ─── SVG ──────────────────────────────────────────────────────────────────────

def to_svg(matrix, size_mm=SIZE_MM, quiet=QUIET_MOD, standalone=True) -> str:
    """
    standalone=True  → includes white background rect (for printing/viewing alone)
    standalone=False → dark modules path only (for Bambu Studio / CAD import)
    """
    n      = len(matrix)
    ntot   = n + 2 * quiet
    ms     = size_mm / ntot
    margin = quiet * ms

    cmds = []
    for r, row in enumerate(matrix):
        for c, dark in enumerate(row):
            if dark:
                x = margin + c * ms
                y = margin + r * ms
                cmds.append(f"M{x:.5f},{y:.5f} h{ms:.5f} v{ms:.5f} h{-ms:.5f} z")

    path_d = " ".join(cmds)
    bg_line = (
        f'<rect width="{size_mm}" height="{size_mm}" fill="white"/>\n'
        if standalone else ""
    )
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg"'
        f' width="{size_mm}mm" height="{size_mm}mm"'
        f' viewBox="0 0 {size_mm} {size_mm}">\n'
        f'{bg_line}'
        f'<path d="{path_d}" fill="black"/>\n'
        f'</svg>'
    )


# ─── Flat mesh helpers ────────────────────────────────────────────────────────

def _box(x0, y0, z0, x1, y1, z1):
    v = [
        (x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0),
        (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1),
    ]
    t = [
        (0, 3, 2), (0, 2, 1),   # -Z bottom
        (4, 5, 6), (4, 6, 7),   # +Z top
        (0, 1, 5), (0, 5, 4),   # -Y front
        (2, 3, 7), (2, 7, 6),   # +Y back
        (0, 4, 7), (0, 7, 3),   # -X left
        (1, 2, 6), (1, 6, 5),   # +X right
    ]
    return v, t


def _merge(boxes):
    verts, tris = [], []
    for bv, bt in boxes:
        off = len(verts)
        verts.extend(bv)
        tris.extend((a + off, b + off, c + off) for a, b, c in bt)
    return verts, tris


def _offset(mesh, dx, dy, dz):
    v, t = mesh
    return [(x + dx, y + dy, z + dz) for x, y, z in v], t


def make_objects(matrix, size_mm=SIZE_MM, thick_mm=THICK_MM,
                 quiet=QUIET_MOD, z_offset=0.0, centered=False,
                 modules_only=False):
    """
    modules_only=False → returns (bg_mesh, qr_mesh)  — standalone QR plate
    modules_only=True  → returns (None,    qr_mesh)  — dark cells only, for
                         dropping onto an existing design (no background object,
                         no conflicts with Body1)
    """
    n    = len(matrix)
    ntot = n + 2 * quiet
    ms   = size_mm / ntot

    bg_boxes, qr_boxes = [], []
    for gr in range(ntot):
        for gc in range(ntot):
            r, c = gr - quiet, gc - quiet
            dark = (0 <= r < n and 0 <= c < n and matrix[r][c])
            x0, y0 = gc * ms, gr * ms
            box = _box(x0, y0, 0, x0 + ms, y0 + ms, thick_mm)
            (qr_boxes if dark else bg_boxes).append(box)

    cx = -size_mm / 2 if centered else 0.0
    cy = -size_mm / 2 if centered else 0.0

    qr = _offset(_merge(qr_boxes), cx, cy, z_offset)
    bg = None if modules_only else _offset(_merge(bg_boxes), cx, cy, z_offset)
    return bg, qr


# ─── 3MF packaging ────────────────────────────────────────────────────────────

_CONTENT_TYPES = """\
<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels"   ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="model"  ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
  <Default Extension="config" ContentType="application/xml"/>
</Types>"""

_RELS = """\
<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" Target="/3D/3dmodel.model"/>
</Relationships>"""

# Both objects: bg = filament 1, qr modules = filament 2
_CONFIG_BOTH = """\
<?xml version="1.0" encoding="UTF-8"?>
<config>
  <object id="1">
    <metadata key="name"     value="QR Background"/>
    <metadata key="extruder" value="1"/>
  </object>
  <object id="2">
    <metadata key="name"     value="QR Modules"/>
    <metadata key="extruder" value="2"/>
  </object>
</config>"""

# Modules only: single object assigned to filament 2 (accent colour on existing model)
_CONFIG_MODULES = """\
<?xml version="1.0" encoding="UTF-8"?>
<config>
  <object id="1">
    <metadata key="name"     value="QR Modules"/>
    <metadata key="extruder" value="2"/>
  </object>
</config>"""


def _obj_xml(obj_id, verts, tris):
    lines = [
        f'    <object id="{obj_id}" type="model">',
        '      <mesh>',
        '        <vertices>',
    ]
    for x, y, z in verts:
        lines.append(f'          <vertex x="{x:.6f}" y="{y:.6f}" z="{z:.6f}"/>')
    lines += ['        </vertices>', '        <triangles>']
    for a, b, c in tris:
        lines.append(f'          <triangle v1="{a}" v2="{b}" v3="{c}"/>')
    lines += ['        </triangles>', '      </mesh>', '    </object>']
    return lines


def to_3mf_bytes(bg_mesh, qr_mesh) -> bytes:
    only_modules = bg_mesh is None

    model = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<model unit="millimeter" xml:lang="en-US"'
        ' xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">',
        '  <resources>',
    ]

    if only_modules:
        model += _obj_xml(1, *qr_mesh)
        model += ['  </resources>', '  <build>', '    <item objectid="1"/>', '  </build>']
        config = _CONFIG_MODULES
    else:
        model += _obj_xml(1, *bg_mesh)
        model += _obj_xml(2, *qr_mesh)
        model += [
            '  </resources>', '  <build>',
            '    <item objectid="1"/>',
            '    <item objectid="2"/>',
            '  </build>',
        ]
        config = _CONFIG_BOTH

    model.append('</model>')

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('[Content_Types].xml',            _CONTENT_TYPES)
        z.writestr('_rels/.rels',                    _RELS)
        z.writestr('3D/3dmodel.model',               '\n'.join(model))
        z.writestr('Metadata/model_settings.config', config)
    return buf.getvalue()


# ─── GUI ──────────────────────────────────────────────────────────────────────

GREY = "#666666"

class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("Innovat3  –  QR Code Generator")
        self.resizable(False, False)
        self._matrix = None
        self._build_ui()
        self._generate()

    def _build_ui(self):
        pad = dict(padx=12, pady=4)

        # ── URL ────────────────────────────────────────────────────────────────
        url_frame = ttk.LabelFrame(self, text="Tag URL", padding=8)
        url_frame.grid(row=0, column=0, sticky="ew", **pad)
        self.url_var = tk.StringVar(
            value="https://innovat3.co.za/card/?tag=IN3-2026-B073"
        )
        ue = ttk.Entry(url_frame, textvariable=self.url_var, width=54)
        ue.grid(row=0, column=0, padx=(0, 8))
        ue.bind("<Return>", lambda _: self._generate())
        ttk.Button(url_frame, text="Generate", command=self._generate).grid(row=0, column=1)

        # ── QR options ─────────────────────────────────────────────────────────
        qr_frame = ttk.LabelFrame(self, text="QR Options", padding=8)
        qr_frame.grid(row=1, column=0, sticky="ew", **pad)
        ttk.Label(qr_frame, text="Error correction:").grid(row=0, column=0, sticky="w")
        self.ec_var = tk.StringVar(value="M  – 15% recovery")
        ttk.Combobox(
            qr_frame, textvariable=self.ec_var,
            values=list(EC_MAP.keys()), width=22, state="readonly",
        ).grid(row=0, column=1, sticky="w", padx=(6, 0))

        # ── Preview ────────────────────────────────────────────────────────────
        cv_frame = ttk.LabelFrame(self, text="Preview  (25 mm × 25 mm)", padding=4)
        cv_frame.grid(row=2, column=0, **pad)
        self.canvas = tk.Canvas(
            cv_frame, width=PREVIEW_PX, height=PREVIEW_PX,
            bg="white", cursor="crosshair",
        )
        self.canvas.pack()

        # ── SVG ────────────────────────────────────────────────────────────────
        svg_frame = ttk.LabelFrame(self, text="SVG Export", padding=8)
        svg_frame.grid(row=3, column=0, sticky="ew", **pad)

        self.svg_standalone_var = tk.BooleanVar(value=True)
        ttk.Radiobutton(
            svg_frame, text="Standalone  (white background included — for viewing / laser cutting)",
            variable=self.svg_standalone_var, value=True,
        ).grid(row=0, column=0, sticky="w")
        ttk.Radiobutton(
            svg_frame, text="Bambu / CAD import  (dark modules path only — no background)",
            variable=self.svg_standalone_var, value=False,
        ).grid(row=1, column=0, sticky="w")

        ttk.Button(
            svg_frame, text="⬇  Export SVG", command=self._export_svg, width=18,
        ).grid(row=2, column=0, sticky="w", pady=(6, 0))

        # ── 3MF ────────────────────────────────────────────────────────────────
        mf_frame = ttk.LabelFrame(self, text="3MF Export", padding=8)
        mf_frame.grid(row=4, column=0, sticky="ew", **pad)

        # Mode selector
        self.modules_only_var = tk.BooleanVar(value=False)

        mo_rb = ttk.Radiobutton(
            mf_frame,
            text="Standalone QR plate  (background + modules — prints on its own as 2 colours)",
            variable=self.modules_only_var, value=False,
            command=self._on_mode_change,
        )
        mo_rb.grid(row=0, column=0, columnspan=4, sticky="w")

        em_rb = ttk.Radiobutton(
            mf_frame,
            text="Add to existing design  (dark modules only — no background, no conflicts in Bambu Studio)",
            variable=self.modules_only_var, value=True,
            command=self._on_mode_change,
        )
        em_rb.grid(row=1, column=0, columnspan=4, sticky="w", pady=(2, 8))

        # Fields row
        ttk.Label(mf_frame, text="Thickness (mm):").grid(row=2, column=0, sticky="w")
        self.thick_var = tk.StringVar(value="2.0")
        ttk.Entry(mf_frame, textvariable=self.thick_var, width=6).grid(
            row=2, column=1, sticky="w", padx=(4, 16)
        )

        self.zoff_label = ttk.Label(mf_frame, text="Z offset (mm):")
        self.zoff_label.grid(row=2, column=2, sticky="w")
        self.zoff_var = tk.StringVar(value="0.0")
        self.zoff_entry = ttk.Entry(mf_frame, textvariable=self.zoff_var, width=6)
        self.zoff_entry.grid(row=2, column=3, sticky="w", padx=(4, 0))

        self.zoff_hint = ttk.Label(
            mf_frame,
            text="  ↑ Set this to the height of your existing tag model so the QR sits flush on top.",
            foreground=GREY,
        )
        self.zoff_hint.grid(row=3, column=0, columnspan=4, sticky="w", pady=(2, 6))

        self.center_var = tk.BooleanVar(value=False)
        ttk.Checkbutton(
            mf_frame,
            text="Centre at origin (X=0, Y=0)  — snap to centre of existing part in Bambu Studio",
            variable=self.center_var,
        ).grid(row=4, column=0, columnspan=4, sticky="w", pady=(0, 6))

        ttk.Button(
            mf_frame, text="⬇  Export 3MF", command=self._export_3mf, width=18,
        ).grid(row=5, column=0, sticky="w")

        # ── Status ─────────────────────────────────────────────────────────────
        self.status_var = tk.StringVar(value="Enter a URL and press Generate.")
        ttk.Label(self, textvariable=self.status_var, anchor="w").grid(
            row=5, column=0, sticky="ew", padx=12, pady=(2, 10)
        )

        self._on_mode_change()   # set initial hint visibility

    def _on_mode_change(self):
        adding = self.modules_only_var.get()
        state  = "normal" if adding else "disabled"
        self.zoff_label.config(foreground="black" if adding else GREY)
        self.zoff_entry.config(state=state)
        self.zoff_hint.config(foreground=GREY if adding else "#cccccc")

    # ── actions ─────────────────────────────────────────────────────────────

    def _generate(self):
        url = self.url_var.get().strip()
        if not url:
            self._set_status("Please enter a URL.")
            return
        try:
            ec = EC_MAP[self.ec_var.get()]
            self._matrix = make_matrix(url, ec)
            self._draw_preview()
            n  = len(self._matrix)
            v  = (n - 17) // 4
            ms = SIZE_MM / (n + 2 * QUIET_MOD)
            self._set_status(
                f"QR version {v}  ·  {n}×{n} modules  ·  module size {ms:.3f} mm"
            )
        except Exception as exc:
            messagebox.showerror("Generation failed", str(exc))

    def _draw_preview(self):
        self.canvas.delete("all")
        if not self._matrix:
            return
        n    = len(self._matrix)
        ntot = n + 2 * QUIET_MOD
        cell = PREVIEW_PX / ntot
        q    = QUIET_MOD * cell
        self.canvas.create_rectangle(0, 0, PREVIEW_PX, PREVIEW_PX, fill="white", outline="")
        for r, row in enumerate(self._matrix):
            for c, dark in enumerate(row):
                if dark:
                    x0 = q + c * cell
                    y0 = q + r * cell
                    self.canvas.create_rectangle(
                        x0, y0, x0 + cell, y0 + cell, fill="black", outline=""
                    )

    def _export_svg(self):
        if self._matrix is None:
            self._set_status("Generate a QR code first.")
            return
        path = filedialog.asksaveasfilename(
            defaultextension=".svg",
            filetypes=[("SVG vector file", "*.svg")],
            initialfile=self._suggest_name("svg"),
        )
        if not path:
            return
        with open(path, "w", encoding="utf-8") as f:
            f.write(to_svg(self._matrix, standalone=self.svg_standalone_var.get()))
        mode = "standalone" if self.svg_standalone_var.get() else "Bambu/CAD import"
        self._set_status(f"SVG saved ({mode})  →  {os.path.basename(path)}")

    def _export_3mf(self):
        if self._matrix is None:
            self._set_status("Generate a QR code first.")
            return
        try:
            thick = float(self.thick_var.get())
            zoff  = float(self.zoff_var.get()) if self.modules_only_var.get() else 0.0
            if thick <= 0:
                raise ValueError("Thickness must be > 0")
        except ValueError as exc:
            messagebox.showerror("Invalid value", str(exc))
            return

        path = filedialog.asksaveasfilename(
            defaultextension=".3mf",
            filetypes=[("3MF 3-D model", "*.3mf")],
            initialfile=self._suggest_name("3mf"),
        )
        if not path:
            return
        try:
            bg, qr = make_objects(
                self._matrix,
                thick_mm=thick,
                z_offset=zoff,
                centered=self.center_var.get(),
                modules_only=self.modules_only_var.get(),
            )
            data = to_3mf_bytes(bg, qr)
            with open(path, "wb") as f:
                f.write(data)
            mode = "modules only" if self.modules_only_var.get() else "standalone"
            self._set_status(
                f"3MF saved ({mode})  →  {os.path.basename(path)}"
            )
        except Exception as exc:
            messagebox.showerror("3MF export failed", str(exc))

    def _suggest_name(self, ext):
        m = re.search(r'tag=([^&\s]+)', self.url_var.get())
        tag = m.group(1) if m else "qr_code"
        return f"{tag}.{ext}"

    def _set_status(self, msg):
        self.status_var.set(msg)


# ─── Entry point ──────────────────────────────────────────────────────────────

if __name__ == "__main__":
    app = App()
    app.mainloop()
