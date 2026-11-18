class Boid extends V2D {
	constructor(index) {
		super(random(g.width), random(g.height));

		this.vel = V2D.random(random(opt.minSpeed, opt.maxSpeed));
		this.acc = new V2D();

		this.index = index;

		// per-bird variation gives the "ink speckle" depth of a murmuration
		this.sizeVar = 0.55 + Math.random() * 0.8;
		this.alphaVar = 0.55 + Math.random() * 0.45;
		// stagger so the picture assembles like a wave, not all at once
		this.lag = Math.random();

		this.shape = new PIXI.Graphics();
		this.shapeMode = null;

		this.desired = new PIXI.Graphics();
		this.desired.clear();
		this.desired.beginFill();
		this.desired.lineStyle(2, hsv(0.9, 5, 1));
		this.desired.moveTo(0, 0);
		this.desired.lineTo(24, 0);
		this.desired.endFill();
		this.desired.alpha = 0;

		layer.addChild(this.shape);
		app.stage.addChild(this.desired);
	}

	neighbors(flock) {
		const cands = flock.candidates(this);
		const ns = [];
		const ds = [];

		const candidate_count = cands
			.map(c => c.length)
			.reduce((a, b) => a + b, 0);
		let step =
			opt.accuracy === 0 ? 1 : Math.ceil(candidate_count / opt.accuracy);
		let i = Math.floor(random(step));

		for (const c of cands) {
			for (; i < c.length; i += step) {
				if (this === c[i]) continue;

				const d = this.sqrDist(c[i]);
				if (d < g.sqVis) {
					ns.push(c[i]);
					ds.push(d);
				}
			}
			i -= c.length;
		}

		return [ns, ds];
	}

	flock(flock) {
		this.acc.zero();

		const aln = new V2D();
		const csn = new V2D();
		const sep = new V2D();

		let [ns, ds] = this.neighbors(flock);

		let i = 0;
		for (const other of ns) {
			// alignment is the average of velocity * bias strength ^ dot
			const b = opt.bias ** other.vel.dot(this.vel);
			aln.sclAdd(other.vel, b);

			// cohesion finds the average of positions
			csn.add(other);

			// separation is stronger for closer boids, so it's multiplied by d
			const d = 1 / (ds[i] || 0.00001);
			sep.x += (this.x - other.x) * d;
			sep.y += (this.y - other.y) * d;

			i++;
		}

		if (ns.length > 0) {
			aln.setMag(opt.maxSpeed).sub(this.vel).max(opt.maxForce);

			csn.div(ns.length)
				.sub(this)
				.setMag(opt.maxSpeed)
				.sub(this.vel)
				.max(opt.maxForce);

			sep.setMag(opt.maxSpeed).sub(this.vel).max(opt.maxForce);
		}

		const free = 1 - this.formWeight();
		this.acc.sclAdd(aln, opt.alignment * free);
		this.acc.sclAdd(csn, opt.cohesion * free);
		this.acc.sclAdd(sep, opt.separation * free);
	}

	formWeight() {
		if (!g.form) return 0;
		return constrain((g.form - this.lag * 0.35) / 0.65, 0, 1);
	}

	seek() {
		const f = this.formWeight();
		if (f <= 0) return;
		const tg = images.target(this.index);
		if (!tg) return;
		const dx = tg[0] - this.x,
			dy = tg[1] - this.y;
		const d = Math.hypot(dx, dy) || 1;
		// arrive: full speed far away, slowing to a stop on its point
		const speed = Math.min(opt.maxSpeed * 1.6, d * 0.06);
		const sx = (dx / d) * speed - this.vel.x,
			sy = (dy / d) * speed - this.vel.y;
		const lim = 0.25 + opt.maxForce * 2;
		const m = Math.hypot(sx, sy);
		const k = m > lim ? lim / m : 1;
		this.acc.x += sx * k * f * 2;
		this.acc.y += sy * k * f * 2;
	}

	interact() {
		if (opt.particle || opt.vision === 0) {
			this.acc.zero();
		}

		this.seek();

		for (const h of g.hands) this.hand(h);

		if (g.mouse.down && g.mouse.over) {
			const mv = new V2D(g.mouse.x, g.mouse.y);

			const d = mv.sqrDist(this);

			mv.sub(this)
				.setMag(10000 / (d || 1))
				.max(g.mouseForce);

			if (g.mouse.button === 0) {
				this.acc.add(mv);
			} else if (g.mouse.button === 2) {
				this.acc.sub(mv);
			}
		}

		if (g.explode > 0.001) {
			const ev = g.explodePos.clone();

			const d = ev.sqrDist(this);

			ev.sub(this)
				.setMag((g.explode * 100000) / (d || 1))
				.max(g.mouseForce * 3);

			this.acc.sub(ev);
		}
	}

	hand(h) {
		// fist with an image loaded is used to form the image instead
		if (h.gesture === "pinch") return;
		if (h.gesture === "fist" && opt.handForm && g.form > 0) return;

		const dx = h.x - this.x,
			dy = h.y - this.y;
		const d2 = dx * dx + dy * dy || 1;
		const d = Math.sqrt(d2);
		const power = opt.handPower;

		// the same falloff as the mouse, but reaching further
		let m = Math.min((25000 * power) / d2, g.mouseForce * 1.5 * power);
		const sign = h.gesture === "fist" ? -1 : 1;
		this.acc.x += (dx / d) * m * sign;
		this.acc.y += (dy / d) * m * sign;

		// an open hand also drags nearby boids along with its sweep
		if (h.gesture === "open") {
			const near = Math.max(0, 1 - d / 220);
			this.acc.x += h.vx * 0.08 * near * power;
			this.acc.y += h.vy * 0.08 * near * power;
		}
	}

	update() {
		this.vel.sclAdd(this.acc, g.delta);

		if (opt.drag) this.vel.mult(1 - opt.drag);

		const f = this.formWeight();
		if (opt.noise) this.vel.rotate(random(-g.noiseRange, g.noiseRange) * (1 - f));

		const minSpeed = opt.minSpeed * (1 - f);
		if (minSpeed > 0.001) {
			if (this.vel.sqrMag() === 0) this.vel.random(minSpeed);
			else this.vel.min(minSpeed);
		}
		if (f > 0) this.vel.mult(1 - 0.06 * f); // settle on the point

		this.vel.max(opt.maxSpeed * (1 + f * 0.6));
		this.sclAdd(this.vel, g.delta);

		// almost formed: ease onto the exact spot so the pieces lock together
		if (f > 0.55) {
			const tg = images.target(this.index);
			if (tg) {
				const k = Math.min(1, ((f - 0.55) / 0.45) ** 2 * 0.35 * g.delta);
				this.x += (tg[0] - this.x) * k;
				this.y += (tg[1] - this.y) * k;
				if (f >= 0.999) {
					// fully formed: sit exactly on the spot
					this.x = tg[0];
					this.y = tg[1];
					this.vel.mult(0.2);
				}
			}
		}

		if (opt.bounce) {
			let ran = false;
			if (this.x < 0 || this.x > g.width) {
				ran = true;
				this.vel.x *= -1;
			}
			if (this.y < 0 || this.y > g.height) {
				ran = true;
				this.vel.y *= -1;
			}
			if (ran) {
				this.x = constrain(this.x, 0, g.width);
				this.y = constrain(this.y, 0, g.height);
			}
		} else {
			this.x = ((this.x % g.width) + g.width) % g.width;
			this.y = ((this.y % g.height) + g.height) % g.height;
		}
	}

	show() {
		this.shape = this.getShape();
		this.shape.x = this.x;
		this.shape.y = this.y;
		this.shape.rotation = this.vel.angle();

		this.showTile();

		if (opt.hues)
			this.shape.tint = hsv(
				constrain(this.vel.mag() / (opt.maxSpeed * 2), 0, 1),
				1,
				1
			);
		else {
			const c = images.color(this.index);
			this.shape.tint = c !== null ? c : opt.murmur ? INK : 0xffffff;
		}

		if (opt.desired && this.acc.sqrMag() > 0.01) {
			this.desired.alpha = 0.5;
			this.desired.x = this.x;
			this.desired.y = this.y;
			this.desired.rotation = this.acc.angle();
		} else this.desired.alpha = 0;
	}

	showTile() {
		const tex = images.tile(this.index);
		if (!tex) {
			if (this.tile) this.tile.visible = false;
			this.shape.visible = true;
			return;
		}
		if (!this.tile) {
			this.tile = new PIXI.Sprite(tex);
			this.tile.anchor.set(0.5);
			layer.addChild(this.tile);
		}
		if (this.tile.texture !== tex) this.tile.texture = tex;
		this.shape.visible = false;

		const f = this.formWeight();
		const pose = images.tilePose();
		// in flight the piece shrinks and turns with its heading;
		// formed, it locks into place, a hair larger to hide the seams
		const k = pose.scale * (opt.imgFly * (1 - f) + 1.03 * f);
		this.tile.visible = true;
		this.tile.x = this.x;
		this.tile.y = this.y;
		this.tile.rotation = this.vel.angle() * (1 - f) + pose.rot * f;
		this.tile.scale.set(k * (pose.sx * f + (1 - f)), k * (pose.sy * f + (1 - f)));
		this.tile.alpha = 1;
	}

	getShape() {
		if (this.shapeMode !== g.shapeMode) {
			this.shape.clear();

			const k = opt.murmur ? this.sizeVar : 1;
			// carrying a piece of the image: the sprite is drawn instead
			if (images.tile(this.index)) {
				this.shapeMode = g.shapeMode;
				return this.shape;
			}

			if (!opt.hideBoids && opt.murmur) {
				// tiny wedge-shaped speck, like a distant starling
				this.shape.beginFill(0xffffff);
				this.shape.lineStyle();
				this.shape.moveTo(2.4, 0);
				this.shape.lineTo(-1.8, -1.1);
				this.shape.lineTo(-1.2, 0);
				this.shape.lineTo(-1.8, 1.1);
				this.shape.lineTo(2.4, 0);
				this.shape.endFill();
			} else if (!opt.hideBoids) {
				this.shape.beginFill(0xffffff);
				this.shape.lineStyle();
				this.shape.moveTo(6, 0);
				this.shape.lineTo(-6, -4);
				this.shape.lineTo(-4, 0);
				this.shape.lineTo(-6, 4);
				this.shape.lineTo(6, 0);
				this.shape.endFill();
			}

			if (opt.areas || opt.outlines) {
				this.shape.beginFill(0xffffff, opt.areas ? 0.03 : 0);
				this.shape.lineStyle(opt.outlines ? 0.5 : 0, 0xffffff, 0.2);
				this.shape.drawCircle(
					0,
					0,
					(opt.halfAreas ? opt.vision / 2 : opt.vision) / k
				);
				this.shape.endFill();
			}

			this.shape.alpha = opt.murmur ? this.alphaVar : 0.8;
			this.shape.scale.set(k);

			this.shapeMode = g.shapeMode;
		}

		return this.shape;
	}

	destroy() {
		if (this.tile) this.tile.destroy();
		this.shape.destroy();
		this.desired.destroy();
	}
}
