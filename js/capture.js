// 300 dpi capture: re-renders the current frame at print resolution
// and saves a PNG with 300 dpi (pHYs) metadata embedded.
(() => {
	const DPI = 300;
	const PAPERS = { a4: [297, 210], a3: [420, 297], a2: [594, 420] };
	const btn = select("#captureBtn");
	const sizeSel = select("#paperSize");
	const info = select("#captureInfo");

	function maxTexture() {
		const gl = app.renderer.gl;
		return gl ? gl.getParameter(gl.MAX_TEXTURE_SIZE) : 8192;
	}

	// scale factor from screen CSS pixels to output pixels
	function captureScale() {
		const W = g.width,
			H = g.height;
		let s;
		if (sizeSel.value === "screen") {
			s = DPI / 96; // screen size printed at 300 dpi
		} else {
			const [L, S] = PAPERS[sizeSel.value];
			const longPx = (L / 25.4) * DPI;
			const shortPx = (S / 25.4) * DPI;
			// fit the screen frame inside the paper, keeping its aspect ratio
			s = Math.min(longPx / Math.max(W, H), shortPx / Math.min(W, H));
		}
		return Math.min(s, maxTexture() / Math.max(W, H));
	}

	window.getCaptureScale = captureScale;

	function updateInfo() {
		const s = captureScale();
		const w = Math.floor(g.width * s),
			h = Math.floor(g.height * s);
		const mm = px => Math.round((px / DPI) * 25.4);
		info.textContent = `${w} × ${h} px · ${mm(w)} × ${mm(h)} mm @ ${DPI} dpi`;
	}

	// --- PNG pHYs chunk (pixels per metre) ---
	const CRC = new Uint32Array(256).map((_, n) => {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		return c >>> 0;
	});
	function crc32(bytes) {
		let c = 0xffffffff;
		for (const b of bytes) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
		return (c ^ 0xffffffff) >>> 0;
	}
	function withDpi(png, dpi) {
		const ppm = Math.round(dpi / 0.0254);
		const chunk = new Uint8Array(21);
		const v = new DataView(chunk.buffer);
		v.setUint32(0, 9);
		chunk.set([0x70, 0x48, 0x59, 0x73], 4); // "pHYs"
		v.setUint32(8, ppm);
		v.setUint32(12, ppm);
		chunk[16] = 1; // unit: metre
		v.setUint32(17, crc32(chunk.subarray(4, 17)));
		const at = 33; // after signature (8) + IHDR (25)
		const out = new Uint8Array(png.length + 21);
		out.set(png.subarray(0, at), 0);
		out.set(chunk, at);
		out.set(png.subarray(at), at + 21);
		return out;
	}

	function stamp() {
		const d = new Date(),
			p = n => String(n).padStart(2, "0");
		return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
	}

	let busy = false;
	function capture() {
		if (busy) return;
		busy = true;
		const label = btn.textContent;
		btn.textContent = "rendering…";

		// let the label repaint before the heavy render
		setTimeout(() => {
			try {
				const s = captureScale();
				const rt = PIXI.RenderTexture.create({
					width: g.width,
					height: g.height,
					resolution: s
				});
				const explodeVisible = g.sprites.explode.visible;
				g.sprites.explode.visible = false;
				app.renderer.render(app.stage, { renderTexture: rt, clear: true });
				g.sprites.explode.visible = explodeVisible;

				const src = app.renderer.plugins.extract.canvas(rt);
				rt.destroy(true);

				const out = document.createElement("canvas");
				out.width = src.width;
				out.height = src.height;
				const ctx = out.getContext("2d");
				ctx.fillStyle = app.view.style.background || "#efefef";
				ctx.fillRect(0, 0, out.width, out.height);
				ctx.drawImage(src, 0, 0);

				out.toBlob(async blob => {
					const png = withDpi(new Uint8Array(await blob.arrayBuffer()), DPI);
					const url = URL.createObjectURL(new Blob([png], { type: "image/png" }));
					const a = document.createElement("a");
					a.href = url;
					a.download = `boids-${stamp()}-${DPI}dpi.png`;
					document.body.appendChild(a);
					a.click();
					a.remove();
					setTimeout(() => URL.revokeObjectURL(url), 5000);
					btn.textContent = label;
					busy = false;
				}, "image/png");
			} catch (err) {
				console.error(err);
				btn.textContent = "capture failed — try a smaller size";
				setTimeout(() => (btn.textContent = label), 2500);
				busy = false;
			}
		}, 30);
	}

	btn.addEventListener("click", capture);
	sizeSel.addEventListener("change", updateInfo);
	window.addEventListener("resize", updateInfo);
	document.addEventListener("keydown", e => {
		if (e.key === "p" && !e.target.closest("textarea, input, select")) capture();
	});
	updateInfo();
})();
