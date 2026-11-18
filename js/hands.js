// Hand control with MediaPipe HandLandmarker (webcam).
//   open hand  → boids are drawn to your palm and follow its sweep
//   fist       → boids are pushed away (or, with an image loaded, gather into it)
//   pinch      → a burst at the pinch point
const hands = (() => {
	const LIB = "./lib/mediapipe/vision_bundle.mjs";
	const WASM = new URL("./lib/mediapipe/wasm", document.baseURI).href;
	const MODEL =
		"https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
	const BONES = [
		[0, 1], [1, 2], [2, 3], [3, 4],
		[0, 5], [5, 6], [6, 7], [7, 8],
		[5, 9], [9, 10], [10, 11], [11, 12],
		[9, 13], [13, 14], [14, 15], [15, 16],
		[13, 17], [17, 18], [18, 19], [19, 20], [0, 17]
	];

	const video = select("#handVideo");
	const btn = select("#handStart");
	const status = select("#handStatus");

	let landmarker = null,
		stream = null,
		running = false,
		lastTime = -1;

	// per-hand state, keyed by slot 0/1
	const slots = [0, 1].map(() => ({
		x: 0, y: 0, vx: 0, vy: 0,
		seen: false, gesture: "open", pending: "open", count: 0,
		pts: []
	}));

	// overlay drawn on the stage
	const overlay = new PIXI.Graphics();
	app.stage.addChild(overlay);

	// ---------- geometry ----------
	const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
	function toScreen(p) {
		// mirror like a selfie and leave a margin so screen edges are reachable
		const m = 0.12;
		return {
			x: constrain(((1 - p.x) - m) / (1 - 2 * m), 0, 1) * g.width,
			y: constrain((p.y - m) / (1 - 2 * m), 0, 1) * g.height
		};
	}

	function classify(lm) {
		const size = dist(lm[0], lm[9]) || 1e-6;
		const ext = (tip, pip) => dist(lm[0], lm[tip]) > dist(lm[0], lm[pip]) * 1.12;
		const n = ext(8, 6) + ext(12, 10) + ext(16, 14) + ext(20, 18);
		const pinch = dist(lm[4], lm[8]) < size * 0.3;
		if (n === 0 && dist(lm[0], lm[8]) < size * 1.15) return "fist";
		if (pinch) return "pinch";
		if (n <= 1 && !ext(8, 6)) return "fist";
		return "open";
	}

	// ---------- camera + model ----------
	async function start() {
		if (running) return stop();
		btn.disabled = true;
		try {
			status.textContent = "loading hand model…";
			if (!landmarker) {
				const { FilesetResolver, HandLandmarker } = await import(LIB);
				const files = await FilesetResolver.forVisionTasks(WASM);
				const make = delegate =>
					HandLandmarker.createFromOptions(files, {
						baseOptions: { modelAssetPath: MODEL, delegate },
						runningMode: "VIDEO",
						numHands: 2,
						minHandDetectionConfidence: 0.5,
						minHandPresenceConfidence: 0.5,
						minTrackingConfidence: 0.5
					});
				try {
					landmarker = await make("GPU");
				} catch {
					landmarker = await make("CPU");
				}
			}
			status.textContent = "asking for the camera…";
			stream = await navigator.mediaDevices.getUserMedia({
				video: { width: 640, height: 480, facingMode: "user" },
				audio: false
			});
			video.srcObject = stream;
			await video.play();
			running = true;
			btn.textContent = "stop camera";
			status.textContent = "show your hand to the camera";
			document.body.classList.add("hand-on");
			requestAnimationFrame(detect);
		} catch (err) {
			console.error(err);
			status.textContent =
				err && err.name === "NotAllowedError"
					? "camera permission was denied"
					: "could not start: " + (err?.message || err);
			stopStream();
		}
		btn.disabled = false;
	}

	function stopStream() {
		if (stream) stream.getTracks().forEach(t => t.stop());
		stream = null;
		video.srcObject = null;
	}

	function stop() {
		running = false;
		stopStream();
		for (const s of slots) s.seen = false;
		g.hands = [];
		btn.textContent = "start camera";
		status.textContent = "camera off";
		document.body.classList.remove("hand-on");
		overlay.clear();
	}

	function detect() {
		if (!running) return;
		if (video.readyState >= 2 && video.currentTime !== lastTime) {
			lastTime = video.currentTime;
			const res = landmarker.detectForVideo(video, performance.now());
			ingest(res.landmarks || []);
		}
		requestAnimationFrame(detect);
	}

	// ---------- results → g.hands ----------
	function ingest(list) {
		const out = [];
		slots.forEach((s, i) => {
			const lm = list[i];
			if (!lm) {
				s.seen = false;
				return;
			}
			const palm = [0, 5, 9, 13, 17].map(k => toScreen(lm[k]));
			const px = palm.reduce((a, p) => a + p.x, 0) / 5;
			const py = palm.reduce((a, p) => a + p.y, 0) / 5;
			if (!s.seen) {
				s.x = px;
				s.y = py;
				s.vx = s.vy = 0;
			}
			const nx = s.x + (px - s.x) * 0.55,
				ny = s.y + (py - s.y) * 0.55;
			s.vx = s.vx * 0.6 + (nx - s.x) * 0.4;
			s.vy = s.vy * 0.6 + (ny - s.y) * 0.4;
			s.x = nx;
			s.y = ny;
			s.pts = lm.map(toScreen);

			// debounce gestures so they don't flicker
			const gst = classify(lm);
			if (gst === s.pending) s.count++;
			else {
				s.pending = gst;
				s.count = 1;
			}
			if (s.count >= 3 && s.gesture !== gst) {
				if (gst === "pinch") burst(s);
				s.gesture = gst;
			}
			s.seen = true;
			out.push({ x: s.x, y: s.y, vx: s.vx, vy: s.vy, gesture: s.gesture });
		});
		g.hands = out;

		status.textContent = out.length
			? out.map((h, i) => `hand ${i + 1}: ${h.gesture}`).join(" · ")
			: "no hand in view";
	}

	function burst(s) {
		const p = s.pts[4] && s.pts[8]
			? { x: (s.pts[4].x + s.pts[8].x) / 2, y: (s.pts[4].y + s.pts[8].y) / 2 }
			: s;
		g.explode = 0.8;
		g.explodePos.set(p.x, p.y);
		g.sprites.explode.x = p.x;
		g.sprites.explode.y = p.y;
	}

	// ---------- drawing ----------
	function draw() {
		overlay.clear();
		if (!running || !opt.handShow) return;
		const col = opt.murmur ? INK : 0xffffff;
		for (const s of slots) {
			if (!s.seen) continue;
			overlay.lineStyle(1, col, 0.25);
			for (const [a, b] of BONES) {
				overlay.moveTo(s.pts[a].x, s.pts[a].y);
				overlay.lineTo(s.pts[b].x, s.pts[b].y);
			}
			overlay.lineStyle();
			overlay.beginFill(col, 0.45);
			for (const p of s.pts) overlay.drawCircle(p.x, p.y, 2);
			overlay.endFill();

			overlay.lineStyle(1.5, col, 0.55);
			if (s.gesture === "fist") overlay.beginFill(col, 0.12);
			overlay.drawCircle(s.x, s.y, s.gesture === "pinch" ? 8 : 22);
			overlay.endFill();
		}
		// keep the overlay on top of everything
		app.stage.addChild(overlay);
	}

	btn.addEventListener("click", start);

	return {
		draw,
		overlay,
		get active() {
			return running && g.hands.length > 0;
		}
	};
})();
