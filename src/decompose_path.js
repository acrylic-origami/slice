import {Vector} from 'matter-js';
import createRBTree from 'functional-red-black-tree';

import {DIRS, EPS} from './consts';
import {lines_intersect, angle_score, s2p} from './Util/geom';

function hash_edge(idx0, idx1) {
	return `${Math.min(idx1, idx0)},${Math.max(idx1, idx0)}`;
}

/**
 * Find the exterior of a self-intersecting polygon defined by a discrete unbroken path
 * @param {{ path: Vector[], s_xs_tree: RBTree }}
 * @param {float}
 * @param {float}
 * @param {-1|1} switch to the closest path { 1: clockwise, -1: anticlockwise } at intersects
 * @param {float}
 * @param {int} used internally
 * @returns {(Vector[], float[])} path along one hemisphere of exterior, s-params of intersects involved in boundary
 */
function find_exterior(augmented_path, s_prev, s_next, dir = 1, s_first = -1, depth = 0) {
	const {path, s_xs, s_xs_tree} = augmented_path;
	// TODO assert: s_next !== s_prev
	// reached the end or beginning; wherever s_xs_tree has no entry
	if(s_next == null) {
		return [[s2p(path, s_prev)], []]; // BASE CASE: endpoint
	}
	
	// map: all adjacencies from s_next -> smallest-path angle to adjacency
	let min = Infinity;
	let argmin = null;
	// ceil(s) - 1 vs. floor(s) is important only when we're right on a waypoint of thte path and s is an integer
	// in this case, we have to choose the trailing and leading edge
	const s_ref_dV_low = s_next > s_prev ? (Math.ceil(s_next) - 1) : Math.floor(s_next);
	// reference vector points backwards vs. our travelling direction (s_prev -> s_next)
	const ref = Vector.normalise(Vector.mult(Vector.sub(path[s_ref_dV_low + 1], path[s_ref_dV_low]), s_prev - s_next));
	for(const s_overlap of s_xs.get(s_next)) {
		// used to have s_overlap !== s_next, but actually in an extreme corner case (where the intersection point is right on a draw point which doubles back) this might be a necessary case
		
		const idx_overlap = s_xs_tree.find(s_overlap).index;
		const idx_adjs = [[idx_overlap - 1, Math.ceil(s_overlap) - 1], [idx_overlap + 1, Math.floor(s_overlap)]]; // second ele of tuple deals with integer s_overlap to choose the relevant heading
		idx_adjs.splice(+(s_next < s_prev), +(s_overlap === s_next)); // prevent loopback -- ignore s_prev as an adjacency
		for(const [idx_adj, s_dV_low] of idx_adjs) {
			// note: we defer here dealing with path endpoints to the next function call
			// i.e. (endpoint_condition as (idx_adj < 0 || idx_adj >= s_xs_tree.length)) -> (encpoint_condition as s_xs_tree.find(idx_adj).key == null)
			const s_adj = idx_adj < 0 ? 0 : (idx_adj >= s_xs_tree.length ? path.length : s_xs_tree.at(idx_adj).key);
			const target = Vector.normalise(Vector.mult(Vector.sub(path[s_dV_low + 1], path[s_dV_low]), s_adj - s_overlap));
			
			const score = angle_score(ref, target) * dir;
			
			if(score < min) {
				min = score;
				argmin = [s_overlap, idx_adj];
			}
		}
	}
	
	// if(depth > 100)
	// 	debugger;
	
	const [ret_path, ret_xs] = (() => {
		// check for cycle
		if(!s_xs.get(s_next).has(s_first))
			 return find_exterior(augmented_path, argmin[0], s_xs_tree.at(argmin[1]).key, dir, s_first, depth + 1);
		else
			return [[], []]; // BASE CASE: cycle
	})();
	ret_xs.push([s_prev, s_next]);
	
	// extract edge between this and next intersect
	let E = path.slice(
		Math.ceil(Math.min(s_prev, s_next)),
		Math.floor(Math.max(s_prev, s_next)) + 1
	);
	if(s_prev < s_next)
		E = E.reverse();
	
	ret_path.push.apply(ret_path, E);
	ret_path.push(s2p(path, s_prev));
	// (path: Array<Vector>, intersect_s_params: Array<float>)
	return [ret_path, ret_xs];
}

/**
 * @returns {(Array<(Vector[], float[])>, Vector[][])} exterior paths (both including starting and ending paths), interior polygons (implicitly closed; first point not duplicated)
 */
export default function(path) {
	// 1. Find s-params of all intersects and link together s-params of coincident intersects
	// 2. Choose a clock direction `dir`
	// 3. Starting from the closest intersect to the path start, find adjcent intersects by nearest-neighbour on s-params
	// 4  Discover the exterior by turning as sharply `dir`-wise as possible at every intersect (via find_exterior)
	// 5. Separate out internal edges from external ones
	// 6. Iterate over internal edges, turning solely clockwise and solely anticlockwise to discover polygons
	
	// Vulnerabilities:
	// 	intersections with the entry or exit point (where ceil(s) - 1 or floor(s) + 1 will fail)
	
	// collapse intersects into sets of overalpping points
	const s_xs = new Map();
	for(let i = 0; i < path.length - 1; i++) {
		for(let j = i + 2; j < path.length - 1; j++) {
			const maybe_intersect = lines_intersect([path[i], path[i+1]], [path[j], path[j+1]]);
			if(maybe_intersect != null) {
				const s_i = i+maybe_intersect[0], s_j = j+maybe_intersect[1];
				if(s_xs.has(s_i)) { // only this check needed because of order of iteration
					s_xs.get(s_i).add(s_j);
				}
				else {
					s_xs.set(s_i, new Set([s_i, s_j]));
				}
				s_xs.set(s_j, s_xs.get(s_i));
			}
		}
	}
	// sort intersects into red-black tree for fast 1D nearest-neighbour
	let s_xs_tree = createRBTree();
	for(const [_, s_x] of s_xs) {
		// console.log(_, s_x);
		for(const s of s_x) {
			if(s_xs_tree.find(s).key == null)
				s_xs_tree = s_xs_tree.insert(s, null);
		}
	}
	
	
	const augmented_path = {path, s_xs, s_xs_tree};
	const boundaries = DIRS.map(dir => find_exterior(augmented_path, EPS, s_xs_tree.begin.key, dir));
	const end_path = s_xs_tree.length === 0 ? path.slice(1) : path.slice(Math.floor(s_xs_tree.end.key) + 1);
	for(const [bound_path, _] of boundaries)
		bound_path.splice.bind(bound_path, 0, 0).apply(bound_path, end_path.reverse());
		
		
	const polys = [];
	
	const boundary_edge_set = new Set();
	for(const [_, bound_xs] of boundaries) {
		for(const x of bound_xs)
			boundary_edge_set.add(hash_edge(s_xs_tree.find(x[0]).index, s_xs_tree.find(x[1]).index)); // prev -> next
	}
	
	// Map<intersection_idx: int, (bool, bool)> have we yet built a polygon travelling along the clock direction (index of boolean tuple) relative to the positive edge vector (min(s) -> max(s))?
	const inner_edges = new Map(); // "visited" structure over edges
	const update_inner_edges = (idx0, idx1, dir_idx) => {
		// idempotently flag this edge-direction combo as visited
		// unsurprisingly closes over `inner_edges`
		const normalized_dir_idx = +(idx1 < idx0) ^ dir_idx;
		const hash = hash_edge(idx0, idx1);
		if(!inner_edges.has(hash))
			inner_edges.set(hash, [false, false]);
		const prev_visited = inner_edges.get(hash)[normalized_dir_idx];
		inner_edges.get(hash)[normalized_dir_idx] = true;
		return prev_visited;
	}
	
	for(const [_, s_x] of s_xs) {
		for(const x of s_x) {
			const idx_x = s_xs_tree.find(x).index;
			for(let dir_idx = 0; dir_idx < DIRS.length; dir_idx++) {
				const idx_adjs = [idx_x - 1, idx_x + 1];
				if(idx_x === 0)
					idx_adjs.splice(0, 1);
				if(idx_x === s_xs_tree.length - 1)
					idx_adjs.splice(-1, 1);
				
				for(const idx_adj of idx_adjs) {
					if(!boundary_edge_set.has(hash_edge(idx_x, idx_adj)) && !update_inner_edges(idx_x, idx_adj, dir_idx)) {
						const s0 = s_xs_tree.at(idx_x).key, s1 = s_xs_tree.at(idx_adj).key
						const [poly, poly_xs] = find_exterior(augmented_path, s0, s1, DIRS[dir_idx], s0);
						polys.push(poly);
						for(const [poly_s_x, poly_s_adj] of poly_xs) {
							update_inner_edges(s_xs_tree.find(poly_s_x).index, s_xs_tree.find(poly_s_adj).index, dir_idx);
						}
					}
				}
			}
		}
	}
	return [boundaries, polys];
	// for(const poly of polys) {
	// 	ctx.beginPath();
	// 	ctx.fillStyle = `rgb(${Math.floor(Math.random() * 256)},${Math.floor(Math.random() * 256)},${Math.floor(Math.random() * 256)})`;
	// 	ctx.moveTo(poly[0].x, poly[0].y);
	// 	for(let i = 1; i < poly.length; i++) {
	// 		ctx.lineTo(poly[i].x, poly[i].y);
	// 	}
	// 	ctx.closePath();
	// 	ctx.fill();
	// }
	
	// const colors = ['red', 'green'];
	// for(let i = 0; i < boundaries.length; i++) {
	// 	const boundary = boundaries[i];
	// 	ctx.beginPath();
	// 	ctx.strokeStyle = colors[i];
	// 	ctx.lineWidth = 2;
	// 	ctx.moveTo(boundary[0][0].x, boundary[0][0].y)
	// 	for(let i = 1; i < boundary[0].length; i++) {
	// 		ctx.lineTo(boundary[0][i].x, boundary[0][i].y);
	// 	}
	// 	ctx.stroke();
	// }
}