// Image forms: an uploaded image is broken into points (one per boid).
// Each boid carries its own point; the flock gathers into the picture,
// holds, scatters, then re-forms as a new variation of the same image.
const images = (() => {
	const SAMPLE_MAX = 640; // sampling canvas size (long edge)

	let base = null; // { xs, ys, cols } in fitted screen px, centred on 0,0
	let img = null; // HTMLImageElement
	let fitKey = "";
	let targets = new Float32Array(0);
	let colors = [];
	let variant = null;
	let cycleCount = 0;

	// ---------- sampling ----------
	function pixelsOf(image) {
		const s = Math.min(1, SAMPLE_MAX / Math.max(image.width, image.height));
		const w = Math.max(1, Math.round(image.width * s));
		const h = Math.max(1, Math.round(image.height * s));
		const c = document.createElement("canvas");
		c.width = w;
		c.height = h;
		const ctx = c.getContext("2d", { willReadFrequently: true });
		ctx.drawImage(image, 0, 0, w, h);
		return { w, h, data: ctx.getImageData(0, 0, w, h).data };
	}

	// Tile mode: the image itself is cut into a grid of pieces, one per boid.
	// Each boid carries its actual piece of the picture; gathered, the pieces
	// lock back into place and the original image reappears.
	const TEX_MAX = 2048; // GPU texture for the pieces (long edge)
	let sheet = null; // { base, w, h }
	let pieceTex = []; // textures made for the current cut

	function makeSheet(image) {
		const s = Math.min(1, TEX_MAX / Math.max(image.width, image.height));
		const c = document.createElement("canvas");
		c.width = Math.max(1, Math.round(image.width * s));
		c.height = Math.max(1, Math.round(image.height * s));
		c.getContext("2d").drawImage(image, 0, 0, c.width, c.height);
		return { base: PIXI.BaseTexture.from(c), w: c.width, h: c.height };
	}

	function sampleTiles(n) {
		const tw = sheet.w,
			th = sheet.h;

		// optional: skip pieces that are only a plain background
		let isBg = () => false,
			frac = 1;
		if (opt.imgDropBg) {
			const { w, h, data } = pixelsOf(img);
			const at = (x, y) => (Math.min(h - 1, Math.max(0, y | 0)) * w + Math.min(w - 1, Math.max(0, x | 0))) * 4;
			const border = [];
			for (let x = 0; x < w; x += 2) border.push(at(x, 0), at(x, h - 1));
			for (let y = 0; y < h; y += 2) border.push(at(0, y), at(w - 1, y));
			const mean = [0, 1, 2].map(c => border.reduce((a, j) => a + data[j + c], 0) / border.length);
			const spread = Math.sqrt(
				border.reduce((a, j) => a + [0, 1, 2].reduce((b, c) => b + (data[j + c] - mean[c]) ** 2, 0), 0) / border.length
			);
			if (spread < 28) {
				const bgPx = j =>
					data[j + 3] < 128 || Math.hypot(data[j] - mean[0], data[j + 1] - mean[1], data[j + 2] - mean[2]) < 34;
				// a piece is background when its centre and corners all are
				isBg = (u0, v0, u1, v1) =>
					[[0.5, 0.5], [0.15, 0.15], [0.85, 0.15], [0.15, 0.85], [0.85, 0.85]].every(([fx, fy]) =>
						bgPx(at((u0 + (u1 - u0) * fx) * w, (v0 + (v1 - v0) * fy) * h))
					);
				let fg = 0, tot = 0;
				for (let y = 0; y < h; y += 3)
					for (let x = 0; x < w; x += 3) {
						tot++;
						if (!bgPx(at(x, y))) fg++;
					}
				frac = Math.min(1, Math.max(fg / tot, 0.02) * 1.25);
			}
		}

		// grid with (at most) n pieces of the kept area
		const want = n / frac;
		const cols = Math.max(1, Math.floor(Math.sqrt((want * tw) / th)));
		const rows = Math.max(1, Math.floor(want / cols));

		const fs = Math.min((g.width * 0.8) / tw, (g.height * 0.8) / th);
		for (const t of pieceTex) t.destroy(false);
		pieceTex = [];
		const cells = [];
		for (let r = 0; r < rows; r++) {
			const y0 = Math.floor((r * th) / rows),
				y1 = Math.floor(((r + 1) * th) / rows);
			for (let c = 0; c < cols; c++) {
				const x0 = Math.floor((c * tw) / cols),
					x1 = Math.floor(((c + 1) * tw) / cols);
				if (x1 <= x0 || y1 <= y0) continue;
				if (isBg(x0 / tw, y0 / th, x1 / tw, y1 / th)) continue;
				const tex = new PIXI.Texture(sheet.base, new PIXI.Rectangle(x0, y0, x1 - x0, y1 - y0));
				pieceTex.push(tex);
				cells.push([((x0 + x1) / 2 - tw / 2) * fs, ((y0 + y1) / 2 - th / 2) * fs, tex]);
			}
		}
		if (!cells.length) return null;

		// shuffle, so neighbouring pieces start far apart in the flock
		for (let i = cells.length - 1; i > 0; i--) {
			const j = (Math.random() * (i + 1)) | 0;
			[cells[i], cells[j]] = [cells[j], cells[i]];
		}
		const xs = new Float32Array(n),
			ys = new Float32Array(n),
			texs = new Array(n);
		for (let i = 0; i < n; i++) {
			// more boids than pieces: spares double up exactly on a piece
			const [x, y, t] = cells[i % cells.length];
			xs[i] = x;
			ys[i] = y;
			texs[i] = t;
		}
		return { xs, ys, cols: [], texs, scale: fs, tiles: true, count: cells.length };
	}

	function sample(n) {
		if (opt.imgTiles) return sampleTiles(n);
		const { w, h, data } = pixelsOf(img);
		const ink = opt.murmur !== opt.imgInvert; // dark pixels on paper
		const N = w * h;
		const lum = new Float32Array(N),
			alpha = new Float32Array(N);
		for (let i = 0; i < N; i++) {
			lum[i] = (0.2126 * data[i * 4] + 0.7152 * data[i * 4 + 1] + 0.0722 * data[i * 4 + 2]) / 255;
			alpha[i] = data[i * 4 + 3] / 255;
		}
		// the photo's own "paper" tone (e.g. a pale grey sky) should count as
		// empty, so measure it and stretch the tones from there
		const sorted = Float32Array.from(lum).sort();
		const paper = ink ? sorted[Math.floor(N * 0.97)] : sorted[Math.floor(N * 0.03)];
		const range = Math.max(ink ? paper : 1 - paper, 0.05);

		const weights = new Float64Array(N);
		let total = 0;
		for (let i = 0; i < N; i++) {
			let tone = ink ? (paper - lum[i]) / range : (lum[i] - paper) / range;
			tone = constrain((tone - 0.06) / 0.94, 0, 1); // drop paper noise
			let wt = tone;
			wt = alpha[i] * Math.pow(wt, opt.imgContrast);
			total += wt;
			weights[i] = total; // cumulative
		}
		if (total <= 0) return null;

		// fit the image to ~80% of the screen
		const W = g.width,
			H = g.height;
		const fs = Math.min((W * 0.8) / w, (H * 0.8) / h);
		const xs = new Float32Array(n),
			ys = new Float32Array(n),
			cols = new Array(n);
		for (let k = 0; k < n; k++) {
			// binary search in the cumulative weights
			const t = Math.random() * total;
			let lo = 0,
				hi = w * h - 1;
			while (lo < hi) {
				const mid = (lo + hi) >> 1;
				if (weights[mid] < t) lo = mid + 1;
				else hi = mid;
			}
			const px = lo % w,
				py = (lo / w) | 0;
			xs[k] = (px + Math.random() - w / 2) * fs;
			ys[k] = (py + Math.random() - h / 2) * fs;
			const j = lo * 4;
			cols[k] = (data[j] << 16) | (data[j + 1] << 8) | data[j + 2];
		}
		return { xs, ys, cols, cell: 0, pixels: false };
	}

	// ---------- variations ----------
	const R = (a, b) => a + Math.random() * (b - a);
	const meta = (fn, m) => Object.assign(fn, { meta: m });
	const VARIANTS = [
		function original() {
			return p => p;
		},
		function turned() {
			const a = R(-0.9, 0.9),
				s = R(0.6, 1.05),
				c = Math.cos(a),
				n = Math.sin(a);
			return meta(([x, y]) => [(x * c - y * n) * s, (x * n + y * c) * s], { rot: a, sx: s, sy: s });
		},
		function wave() {
			const amp = R(25, 70),
				f = R(0.008, 0.02),
				ph = R(0, 6.28);
			return ([x, y]) => [x + amp * Math.sin(y * f + ph), y + amp * 0.4 * Math.sin(x * f * 0.7)];
		},
		function mirrored() {
			return meta(([x, y]) => [-x, y], { sx: -1 });
		},
		function stretched() {
			const sx = R(0.45, 1.25),
				sy = R(0.45, 1.25),
				sk = R(-0.5, 0.5);
			return meta(([x, y]) => [x * sx + y * sk, y * sy], { sx, sy });
		},
		function swirl() {
			const k = R(0.0025, 0.006) * (Math.random() < 0.5 ? -1 : 1);
			return ([x, y]) => {
				const r = Math.hypot(x, y),
					a = r * k,
					c = Math.cos(a),
					s = Math.sin(a);
				return [x * c - y * s, x * s + y * c];
			};
		},
		function shattered() {
			const cell = R(60, 140),
				spread = R(18, 45),
				seed = Math.random() * 1000;
			const h = (i, j, k) => {
				const v = Math.sin(i * 127.1 + j * 311.7 + k * 74.7 + seed) * 43758.5453;
				return (v - Math.floor(v)) * 2 - 1;
			};
			return ([x, y]) => {
				const i = Math.floor(x / cell),
					j = Math.floor(y / cell);
				return [x + h(i, j, 1) * spread, y + h(i, j, 2) * spread];
			};
		},
		function scattered() {
			// two copies of the image side by side, half the flock each
			const s = R(0.45, 0.6),
				gap = R(0.22, 0.3);
			return meta(([x, y], i) => {
				const side = i % 2 ? 1 : -1;
				return [x * s + side * g.width * gap, y * s];
			}, { sx: s, sy: s });
		}
	];

	function pickVariant() {
		const v = cycleCount === 0 ? VARIANTS[0] : VARIANTS[1 + Math.floor(Math.random() * (VARIANTS.length - 1))];
		// small random drift of the whole picture
		const ox = cycleCount === 0 ? 0 : R(-0.08, 0.08) * g.width;
		const oy = cycleCount === 0 ? 0 : R(-0.06, 0.06) * g.height;
		const fn = v();
		variant = { fn, name: v.name, ox, oy, rot: 0, sx: 1, sy: 1, ...(fn.meta || {}) };
		select("#imgVariant").textContent = v.name;
		cycleCount++;
		computeTargets();
	}

	function computeTargets() {
		if (!base || !variant) return;
		const n = base.xs.length;
		if (targets.length !== n * 2) targets = new Float32Array(n * 2);
		const cx = g.width / 2 + variant.ox,
			cy = g.height / 2 + variant.oy;
		for (let i = 0; i < n; i++) {
			const [x, y] = variant.fn([base.xs[i], base.ys[i]], i);
			targets[i * 2] = cx + x;
			targets[i * 2 + 1] = cy + y;
		}
	}

	function rebuild() {
		if (!img) return;
		const n = flock.boids.length;
		base = sample(n);
		if (!base) {
			select("#imgStatus").textContent = "no usable pixels — try invert tones";
			return;
		}
		colors = base.cols;
		fitKey = `${g.width}x${g.height}|${n}|${opt.murmur}|${opt.imgInvert}|${opt.imgTiles}|${opt.imgContrast}|${opt.imgDropBg}`;
		if (!variant) pickVariant();
		else computeTargets();
		g.shapeMode++;
	}

	// ---------- cycle ----------
	const PH = { gather: 0, hold: 1, release: 2, free: 3 };
	let phase = PH.free,
		t = 0;
	const ease = x => x * x * (3 - 2 * x);

	function phaseLen(p) {
		if (p === PH.gather) return 3.5;
		if (p === PH.hold) return opt.imgHold;
		if (p === PH.release) return 1.2;
		return opt.imgFree;
	}

	function advance(dt) {
		t += dt;
		while (t >= phaseLen(phase)) {
			t -= phaseLen(phase);
			phase = (phase + 1) % 4;
			if (phase === PH.gather) pickVariant();
			if (phase === PH.release && opt.imgBurst) {
				g.explode = 0.5;
				g.explodePos.set(g.width / 2 + variant.ox, g.height / 2 + variant.oy);
				g.sprites.explode.x = g.explodePos.x;
				g.sprites.explode.y = g.explodePos.y;
			}
		}
		const k = t / phaseLen(phase);
		if (phase === PH.gather) return ease(k);
		if (phase === PH.hold) return 1;
		if (phase === PH.release) return 1 - ease(k);
		return 0;
	}

	function update(dtSec, running) {
		if (!img || !opt.imgOn) {
			g.form = 0;
			return;
		}
		const key = `${g.width}x${g.height}|${flock.boids.length}|${opt.murmur}|${opt.imgInvert}|${opt.imgTiles}|${opt.imgContrast}|${opt.imgDropBg}`;
		if (key !== fitKey) rebuild();
		if (!base) {
			g.form = 0;
			return;
		}
		const byHand = opt.handForm && typeof hands !== "undefined" && hands.active;
		if (byHand) {
			const fist = g.hands.some(h => h.gesture === "fist");
			g.form += ((fist ? 1 : 0) - g.form) * Math.min(1, dtSec * 1.6);
			if (g.form < 0.002) g.form = 0;
		} else if (opt.imgCycle) {
			if (running) g.form = advance(dtSec);
		} else g.form = opt.imgForm;

		const pct = Math.round(g.form * 100);
		select("#imgStatus").textContent = byHand
			? `hand control · ${pct}%`
			: opt.imgCycle
			? `${["gathering", "holding", "scattering", "flocking"][phase]} · ${pct}%`
			: `form ${pct}%`;
	}

	// ---------- loading ----------
	function load(file) {
		if (!file || !file.type.startsWith("image/")) return;
		const url = URL.createObjectURL(file);
		const im = new Image();
		im.onload = () => {
			img = im;
			if (sheet) sheet.base.destroy();
			sheet = makeSheet(im);
			variant = null;
			cycleCount = 0;
			phase = PH.gather; // start gathering straight away,
			t = 0; // first form is the untouched image
			fitKey = "";
			opt.imgOn = true;
			select("#imgOn").checked = true;
			select("#imgName").textContent = file.name;
			select("#imgThumb").src = url;
			document.body.classList.add("has-image");
		};
		im.src = url;
	}

	function clear() {
		img = null;
		base = null;
		for (const t of pieceTex) t.destroy(false);
		pieceTex = [];
		variant = null;
		g.form = 0;
		document.body.classList.remove("has-image");
		select("#imgName").textContent = "no image";
		select("#imgStatus").textContent = "";
		select("#imgVariant").textContent = "—";
		g.shapeMode++;
	}

	const fileIn = select("#imgFile");
	fileIn.addEventListener("change", () => load(fileIn.files[0]));
	select("#imgPick").addEventListener("click", () => fileIn.click());
	select("#imgClear").addEventListener("click", clear);
	select("#imgNext").addEventListener("click", () => {
		if (!base) return;
		phase = PH.free;
		t = phaseLen(PH.free);
	});

	document.addEventListener("dragover", e => {
		e.preventDefault();
		document.body.classList.add("dragging");
	});
	document.addEventListener("dragleave", e => {
		if (!e.relatedTarget) document.body.classList.remove("dragging");
	});
	document.addEventListener("drop", e => {
		e.preventDefault();
		document.body.classList.remove("dragging");
		load(e.dataTransfer.files[0]);
	});
	document.addEventListener("paste", e => {
		const item = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith("image/"));
		if (item) load(item.getAsFile());
	});

	return {
		update,
		load,
		target(i) {
			if (!base || g.form <= 0 || i * 2 + 1 >= targets.length) return null;
			return [targets[i * 2], targets[i * 2 + 1]];
		},
		color() {
			return null;
		},
		// the piece of the picture boid i carries (tile mode), or null
		tile(i) {
			return base && base.tiles && opt.imgOn && img ? base.texs[i] || null : null;
		},
		// how the pieces should sit when the picture is formed
		tilePose() {
			return variant
				? { scale: base.scale, rot: variant.rot, sx: variant.sx, sy: variant.sy }
				: { scale: base ? base.scale : 1, rot: 0, sx: 1, sy: 1 };
		}
	};
})();
