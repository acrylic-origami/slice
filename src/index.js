import {simplify} from 'simplify-js';
import {Body, Bodies, Bounds, Composite, Engine, Mouse, Render, Vector, World} from 'matter-js';
import {Set, Map} from 'es6-shim';

import BodyCoordCollection from './BodyCoordCollection';
import decompose_path from './decompose_path';
import {world_body_coords, body_world_coords} from './Util/frame';
import {replace_body, poly_to_body} from './Util/slicer';
import {lines_intersect, s2p, angle_score, split, point_in_poly, wrap_slice} from './Util/geom';
import {EPS, DELTA, DIRS} from './consts';

function onload_resize() {
	const pixel_ratio = window.devicePixelRatio || 1.0;
	document.getElementById('overlay').width = window.innerWidth * pixel_ratio;
	document.getElementById('overlay').height = window.innerHeight * pixel_ratio;
}

window.addEventListener('load', e => {
	onload_resize();
	const canvas = document.getElementById('overlay');
	const ctx = canvas.getContext('2d');
	
	/////////////////
	// INIT MATTER //
	/////////////////
	
	const engine = Engine.create();
	const starting_polys = [
		[
			{x: -50, y: -50 },
			{x: 0, y: -25 },
			{x: 50, y: -50 },
			{x: 50, y: 50 },
			{x: 0, y: 25 },
			{x: -50, y: 50 }
		]
	];
	const starting_bodies = starting_polys.map(poly => [Bodies.fromVertices(500, 0, poly), poly]);
	for(const [body, _] of starting_bodies) {
		Body.setStatic(body, false);
		World.addBody(engine.world, body);
	}
	// Body.setVelocity(original, {x: 2, y: -20});
	const mouse = Mouse.create(document.body);
	
	const render = Render.create({
		element: document.body,
		engine: engine,
		options: {
			// wireframes: false,
			width: window.innerWidth,
			height: window.innerHeight
		}
	});
	Render.run(render);
	
	
	////////////////
	// RUN SLICER //
	////////////////
	
	// body id -> precalculated stuff
	const body_metas = new Map(); // bodies where slices are ongoing, tracking body-frame mouse coords
	const delayed_body_mouse = new Map(); // 2-tuple of body-frame mouse coords, used for detecting initial cuts into moving objects, as we implicitly need one unit delay of body position
	const body_coord_collection = new BodyCoordCollection(); // body vertices of concave shapes form the convex hull, which totally ruins cutting; must store exact concave shape ourselves
	for(const [body, poly] of starting_bodies)
		body_coord_collection.set(body.id, poly);
	
	window.requestAnimationFrame(function run(t) {
		window.requestAnimationFrame(run);
		Engine.update(engine, DELTA * 1000);
		
		///////////////
		// PURE EXIT //
		///////////////
		
		// after the mouse slices a body into two daughter bodies, we need to ensure it doesn't slice either daughter where it exited but could slice by entering again further downstream
		// `generated_shells` stores the daughter body IDs. Generally we would need to also store the s-param of the exit, but here the exits always happen along edge (0,1) on the daughter
		const generated_shells = new Set();
		
		for(const [id, body_meta] of body_metas) {
			// TEMP for debugging, so I can preserve body_metas for inspection later
			// TODO: patch memory leak from `body_metas`
			if(Composite.get(engine.world, id, 'body') == null)
				continue;
			
			const body_coords = body_coord_collection.get(id);
			const body = Composite.get(engine.world, id, 'body');
			const mouse_body = world_body_coords(body, mouse.absolute);
			
			// all mouse intersects with this body -> minimum s_coord of mouse, argmin as corresponding body s_coord
			let min_mouse_mant = Infinity, argmin_s_body = null;
			for(let i = 0; i < body_coords.length; i++) {
				const maybe_intersect = lines_intersect([body_meta.path[body_meta.path.length - 1], mouse_body], [body_coords[i], body_coords[(i+1) % body_coords.length]]);
				if(maybe_intersect != null && maybe_intersect[0] < min_mouse_mant) {
					min_mouse_mant = maybe_intersect[0]; // find the first intersect: this is the exit point
					argmin_s_body = i + maybe_intersect[1];
				}
			}
			
			if(argmin_s_body != null) {
				// mouse has exited an extended slice
				const [boundaries, polys] = decompose_path(body_meta.path);
				const bodies = polys.map(poly_to_body);
				for(let i = 0; i < bodies.length; i++) {
					if(bodies[i] != null) // don't totally blow up if a body fails
						body_coord_collection.set(bodies[i].id, polys[i]);
				}
				
				const [increasing_shell, decreasing_shell] = split(body_coords, body_meta.s0, argmin_s_body); // must match boundary CW/CCW with shell CW/CCW
				const ref = Vector.neg(Vector.sub(mouse_body, body_meta.path[body_meta.path.length - 1]));
				for(let dir_idx = 0; dir_idx < boundaries.length; dir_idx++) {
					const decreasing_dir = Vector.neg(
						Vector.sub(
							body_coords[Math.ceil(argmin_s_body) % body_coords.length],
							body_coords[Math.ceil(argmin_s_body) - 1]
						)
					);
					const increasing_dir = Vector.sub(
						body_coords[(Math.floor(argmin_s_body) + 1) % body_coords.length],
						body_coords[Math.floor(argmin_s_body)]
					);
					const boundary = [s2p(body_coords, argmin_s_body)]
						.concat(boundaries[dir_idx][0].slice(0,-1))
						.concat([s2p(body_coords, body_meta.s0)]); // luckily strategic that argmin_s_body is first, so that the ignored edges are on the... well, edges!
					const daughter_poly = boundary.concat((() => {
						// decide between (increasing, decreasing) via which is more in the right clock direction
						if(angle_score(ref, decreasing_dir) * DIRS[dir_idx] > angle_score(ref, increasing_dir) * DIRS[dir_idx])
							return decreasing_shell;
						else
							return increasing_shell;
					})());
					polys.push(daughter_poly);
					const daughter_body = poly_to_body(daughter_poly);
					if(daughter_body != null) {
						body_coord_collection.set(daughter_body.id, daughter_poly);
						bodies.push(daughter_body);
						generated_shells.add(daughter_body.id);
					}
				}
				// console.log('EXIT', body.id);
				
				// TODO: re-enable these deletes to patch memory leaks
				// body_coord_collection.delete(body.id);
				// body_metas.delete(body.id);
				replace_body(engine.world, body, bodies.filter(v => v != null));
			}
			else {
				// add vertex if it's sufficiently different (~>1px) from the previous
				if(Vector.magnitudeSquared(Vector.sub(mouse_body, body_meta.path[body_meta.path.length - 1])) > EPS*EPS) { 
					body_meta.path.push(Vector.add(mouse_body, { x: Math.random() * EPS, y: 0 })); // introduce some wiggle to avoid degeneracy when the mouse is colinear with a polygon edge
				}
			}
		}
		
		
		////////////////
		// ENTER-EXIT //
		////////////////
		
		// instead of for-of for debugging purposes, since FireBug jumps to the surrounding for-of statement when pausing on any exceptions any depth within one
		const all_bodies = Composite.allBodies(engine.world);
		for(let body_idx = 0; body_idx < all_bodies.length; body_idx++) {
			const body = all_bodies[body_idx];
			
			if(!delayed_body_mouse.has(body.id)) {
				delayed_body_mouse.set(body.id, []);
			}
			
			const knife = delayed_body_mouse.get(body.id); // body-frame coordinates of last two mouse positions
			if(knife.length > 1) {
				knife.shift();
			}
			knife.push(world_body_coords(body, mouse.absolute));
			
			if(knife.length > 1 && Bounds.overlaps(body.bounds, Bounds.create(knife.map(body_world_coords.bind(null, body))))) {
				// bounding boxes for quick win
				const body_coords = body_coord_collection.get(body.id);
				const s_xs = []; // s-coords of knife and body intersect
				
				const iter_lims = generated_shells.has(body.id) ? [2, body_coords.length - 1] : [0, body_coords.length]; // new daughters need to avoid being re-cut by the knife where it exited to form them (edges (-1, 0), (0, 1) and (1, 2))
				for(let i = iter_lims[0]; i < iter_lims[1]; i++) {
					const maybe_intersect = lines_intersect([knife[0], knife[1]], [body_coords[i], body_coords[(i+1) % body_coords.length]]);
					if(maybe_intersect != null) {
						const [mouse_mant, body_mant] = maybe_intersect;
						s_xs.push([mouse_mant, i + body_mant]);
					}
				}
				
				// if this knife didn't cut anything all the way, leave the body intact for now and begin an extended cut
				if(s_xs.length === 1 && point_in_poly(knife[1], body_coords)) {
					// we need to check for point in poly of the destination to handle knife points right or very very close to the body edges, which could bounce off but register as an entrance, wrecking havoc later
					// happened in testing surprisingly often...
					// console.log('ENTER', body.id);
					body_metas.set(
						body.id,
						{
							s0: s_xs[0][1],
							path: [knife[1]]
						}
					);
				}
				else if(s_xs.length > 1) {
					// cut some polys along knife using some parities involving knife travel dirction vs. body travel direction
					s_xs.sort((a, b) => a[0] - b[0]);
					const s_body_xs = s_xs.map(([s_mouse, s_body], i) => [s_body, i]);
					s_body_xs.sort((a, b) => a[0] - b[0]);
					
					const bodies = [];
					// while travelling along body, some polys need multiple slices before they're fully cut, so store intersect index (in mouse ordering) and the path to add to this poly eventually.
					// consider for example the large top polygon here:
					/*
					  __________
					 |    TOP   |
					 \    /\    /
					--\--/--\--/--> knife
					   \/    \/
					*/
					
					const poly_defer = []; // Array<(int, Vector[])>
					let resident_poly = null; // NOTE poly in which knife ends up at the end will ALWAYS be a poly_defer by construction (an instant poly is closed by the line and can't contain the end of it)
					let resident_poly_entrance = null; // if the knife ends up lodged in a polygon by the end, which one?
					for(let i = 0; i < s_body_xs.length; i++) {
						const [s_body, idx_mouse] = s_body_xs[i];
						const [next_s_body, next_idx_mouse] = s_body_xs[(i+1) % s_body_xs.length];
						const next_path =
							[s2p(body_coords, s_body)]
								.concat(wrap_slice(body_coords, Math.ceil(s_body), Math.floor(next_s_body) + 1))
								.concat([s2p(body_coords, next_s_body)]);
						
						if(Math.abs(next_idx_mouse - idx_mouse) === 1 && idx_mouse % 2 === +(next_idx_mouse < idx_mouse)) {
							// this parity is hard to explain, draw multiple entrances and exits of knife in concave polygon to understand
							
							// IMMEDIATE POLY
							// console.log('IMM', next_path);
							const body = poly_to_body(next_path);
							if(body != null) {
								body_coord_collection.set(body.id, next_path);
								bodies.push(body);
							}
						}
						else {
							// DEFERRED POLY
							if(s_xs.length % 2 === 1 && idx_mouse === s_xs.length - 1) {
								resident_poly_entrance = poly_defer.reduce((a, [_, p]) => a + p.length, 0) - 1; // length of path thus far
								poly_defer.push([idx_mouse, next_path.slice(1)]); // take the beginning off because this continues this poly_defer immediately from the last iteration, which will also include this common vertex
							}
							else
								poly_defer.push([idx_mouse, next_path]);
							
							if(Math.abs(idx_mouse - poly_defer[0][0]) === 1) {
								// close the top poly when we land next to the starting spot
								
								const total_poly = poly_defer.reduce((poly, [_, path]) => poly.concat(path), []);
								const poly_body = poly_to_body(total_poly);
								if(poly_body != null) {
									body_coord_collection.set(poly_body.id, total_poly);
									bodies.push(poly_body);
								}
								
								poly_defer.splice(0);
								if(resident_poly_entrance != null && point_in_poly(knife[1], total_poly)) {
									// console.log('ENTER', body.id);
									body_metas.set(
										poly_body.id,
										{
											s0: s_body,
											path: [knife[1]]
										}
									);
									resident_poly_entrance = null;
								}
							}
						}
					}
					if(bodies.length > 0) {
						body_coord_collection.delete(body.id);
						replace_body(engine.world, body, bodies);
					}
				}
			}
		}
	});
	
	// window.addEventListener('click', e => {
	// 	if(!begun) {
	// 		ctx.beginPath();
	// 		ctx.moveTo(e.pageX, e.pageY);
	// 		path.push({ x: e.pageX, y: e.pageY });
	// 		begun = true;
	// 	}
	// 	else {
	// 		begun = false;
	// 		decompose_path(path)
	// 	}
	// });
	
	// window.addEventListener('mousemove', e => {
	// 	if(begun) {
	// 		ctx.lineTo(e.pageX, e.pageY);
	// 		path.push({ x: e.pageX, y: e.pageY });
	// 		ctx.stroke();
	// 	}
	// });
});