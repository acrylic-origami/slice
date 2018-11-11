import {Vector, Vertices} from 'matter-js';
import {Set} from 'es6-shim';

import {sgn} from './math';

export function lines_intersect(a, b) {
	// thanks https://stackoverflow.com/a/565282/3925507 !
	
	// TODO: make this more succinct via max > min
	if((new Set([a[0].x >= b[0].x, a[1].x >= b[0].x, a[0].x >= b[1].x, a[1].x >= b[1].x])).size >= 1 &&
		(new Set([a[0].y >= b[0].y, a[1].y >= b[0].y, a[0].y >= b[1].y, a[1].y >= b[1].y])).size >= 1) {
		var b_delta = Vector.sub(b[1], b[0]);
		var a_delta = Vector.sub(a[1], a[0]);
		var u = Vector.cross(
			Vector.sub(a[0], b[0]),
			b_delta
		) / Vector.cross(
			b_delta,
			a_delta
		);
		var t = Vector.cross(
			Vector.sub(a[0], b[0]),
			a_delta
		) / Vector.cross(
			b_delta,
			a_delta
		);
		if(0 <= t && t < 1 && 0 <= u && u < 1)
			return [u, t]; // a param, b param
		else
			return null;
	}
	else
		return null;
}

export function dv(path, s) {
	return Vector.sub(path[Math.ceil(s) % path.length], path[Math.floor(s)]);
}
export function s2p(path, s) {
	const mant = s - Math.floor(s);
	return Vector.add(Vector.mult(dv(path, s), mant), path[Math.floor(s)]);
}

/**
 * Monotonic decreasing function of signed angle without needing atan2
 */
export function angle_score(ref, target) {
	return (sgn(Vector.cross(ref, target)) * (Vector.dot(ref, target) + 1));
}

export function centrify(poly) {
	const C = Vertices.centre(poly);
	return poly.map(v => Vector.sub(v, C));
}

export function split(A, left, right) {
	if(left < right)
		return [
			A.slice(Math.floor(left) + 1, Math.ceil(right)),
			A.slice(Math.floor(right) + 1).concat(A.slice(0, Math.ceil(left))).reverse()
		];
	else
		return [
			A.slice(Math.floor(left) + 1).concat(A.slice(0, Math.ceil(right))),
			A.slice(Math.floor(right) + 1, Math.ceil(left)).reverse()
		];
}
export function point_in_poly(p, poly) {
	// raycast with y-ray; most numerically-stable thing that I can think of
	let xings = 0;
	// console.log(p);
	for(let i = 0; i < poly.length; i++) {
		const E = [poly[i], poly[(i + 1) % poly.length]];
		// console.log(JSON.stringify(E), (E[0].x <= p.x) !== (E[1].x <= p.x), Math.abs((p.x - E[0].x) / (E[1].x - E[0].x)));
		if((E[0].x <= p.x) !== (E[1].x <= p.x) && s2p(E, Math.abs((p.x - E[0].x) / (E[1].x - E[0].x))).y < p.y) // unstable if on the line or point itself
			xings++;
	}
	return xings % 2 === 1;
}
export function wrap_slice(A, l, r) {
	if(l > r)
		return A.slice(l).concat(A.slice(0, r));
	else
		return A.slice(l, r);
}


export function draw_poly(ctx, poly) {
	ctx.beginPath();
	ctx.fillStyle = `rgb(${Math.floor(Math.random() * 256)},${Math.floor(Math.random() * 256)},${Math.floor(Math.random() * 256)})`;
	ctx.moveTo(poly[0].x + 100, poly[0].y + 100);
	for(let i = 1; i < poly.length; i++) {
		ctx.lineTo(poly[i].x + 100, poly[i].y + 100);
	}
	ctx.closePath();
	ctx.fill();
}