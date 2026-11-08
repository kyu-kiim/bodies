// Long-exposure paths: every simulation step the live boid layer is stamped,
// faintly, into a persistent texture, so the flock's routes accumulate.
const trails = (() => {
	const MAX_PIXELS = 40e6; // keeps GPU memory sane at print resolution
	const FADE_STEP = 0.04; // fade in bigger, rarer steps to avoid 8-bit residue

	let rt = null,
		key = "",
		fadeDebt = 0,
		needsClear = true;
	const wash = new PIXI.Graphics();

	// render paths at print resolution so a 300 dpi capture stays sharp
	function resolution() {
		let s =
			typeof getCaptureScale === "function"
				? getCaptureScale()
				: window.devicePixelRatio || 1;
		s = Math.max(s, window.devicePixelRatio || 1);
		return Math.min(s, Math.sqrt(MAX_PIXELS / (g.width * g.height)));
	}

	function bg() {
		return opt.murmur ? PAPER : DARK_BG;
	}

	function paint(alpha) {
		wash.clear();
		wash.beginFill(bg(), alpha);
		wash.drawRect(0, 0, g.width, g.height);
		wash.endFill();
		app.renderer.render(wash, { renderTexture: rt, clear: false });
	}

	function ensure() {
		const res = resolution();
		const k = `${g.width}x${g.height}@${res.toFixed(3)}`;
		if (k !== key) {
			if (rt) rt.destroy(true);
			rt = PIXI.RenderTexture.create({
				width: g.width,
				height: g.height,
				resolution: res
			});
			trailSprite.texture = rt;
			key = k;
			needsClear = true;
		}
		if (needsClear) {
			paint(1);
			needsClear = false;
			fadeDebt = 0;
		}
	}

	let lastTheme = null;
	function step(advanced) {
		if (!opt.trails) {
			trailSprite.visible = false;
			layer.visible = true;
			layer.alpha = 1;
			return;
		}
		if (lastTheme !== opt.murmur) {
			lastTheme = opt.murmur;
			needsClear = true;
		}
		ensure();
		trailSprite.visible = true;

		if (advanced) {
			if (opt.trailFade > 0) {
				fadeDebt += opt.trailFade;
				if (fadeDebt >= FADE_STEP) {
					paint(Math.min(fadeDebt, 1));
					fadeDebt = 0;
				}
			}
			layer.visible = true;
			layer.alpha = opt.trailInk;
			app.renderer.render(layer, { renderTexture: rt, clear: false });
		}

		layer.alpha = 1;
		layer.visible = !opt.hideLive;
	}

	return {
		step,
		clear() {
			needsClear = true;
		}
	};
})();
