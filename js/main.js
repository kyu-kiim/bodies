// murmuration palette
const INK = 0x141414;
const PAPER = 0xefefef;
const DARK_BG = 0x161616;

// useful global variables
const g = {
	mouseForce: 0,

	sqVis: opt.vision * opt.vision,

	mouse: {
		x: 0,
		y: 0,
		down: false,
		over: true,
		button: 0
	},

	explode: 0,
	explodePos: new V2D(),

	nextFrame: false,

	width: window.innerWidth,
	height: window.innerHeight,

	sprites: {
		explode: (() => {
			let shape = new PIXI.Graphics();

			shape.clear();
			shape.beginFill(0xffffff);
			shape.drawCircle(0, 0, 100);
			shape.endFill();

			return shape;
		})()
	},

	delta: 1,
	shapeMode: 1,

	bias: parseFloat(opt.rbias),
	noiseRange: (Math.PI / 80) * opt.noise,

	fpsA: [],
	fps: 60
};

// PIXI app
const app = new PIXI.Application({
	width: g.width,
	height: g.height,
	antialias: true,
	transparent: false,
	resolution: window.devicePixelRatio || 1,
	autoDensity: true,
	backgroundColor: 0x161616
});

document.body.prepend(app.view);

// stacking order: trail canvas → (grid) → live boids → overlays
const trailSprite = new PIXI.Sprite();
app.stage.addChild(trailSprite);
const layer = new PIXI.Container();
app.stage.addChild(layer);

function applyTheme() {
	const bg = opt.murmur ? PAPER : DARK_BG;
	document.body.classList.toggle("light", opt.murmur);
	app.renderer.backgroundColor = bg;
	app.view.style.background = "#" + bg.toString(16).padStart(6, "0");
	g.sprites.explode.tint = opt.murmur ? 0xffffff : 0x000000;
	g.shapeMode++;
}
applyTheme();

let flock = new Flock(opt.boids);

function loop(delta) {
	g.delta = Math.min(delta, 2);

	g.mouseForce = max(
		(opt.maxSpeed *
			opt.maxForce *
			(opt.alignment + opt.cohesion + opt.separation + 1)) /
			16,
		0
	);
	g.sqVis = opt.vision * opt.vision;

	let advanced = false;
	if (!opt.paused) {
		flock.update();
		advanced = true;
	} else if (g.nextFrame) {
		flock.update();
		g.nextFrame = false;
		advanced = true;
	}

	flock.draw();
	if (typeof trails !== "undefined" && trails.step) trails.step(advanced);

	if (g.explode === 1) {
		app.stage.addChild(g.sprites.explode);
	}
	if (g.explode > 0.001) {
		let s = Math.sqrt(g.explode);
		g.sprites.explode.alpha = s;
		g.sprites.explode.scale.x = s;
		g.sprites.explode.scale.y = s;

		g.explode *= 0.9;
	} else if (g.explode !== 0) {
		app.stage.removeChild(g.sprites.explode);
		g.explode = 0;
	}

	if (opt.debug) {
		g.fpsA.push(60 / delta);
		g.fps = g.fpsA.reduce((a, v) => a + v, 0) / 10;
		if (g.fpsA.length >= 10) g.fpsA.shift();
		select("#fps").textContent = g.fps.toFixed(2);
	}

	app.render();
}

app.ticker.add(loop);
