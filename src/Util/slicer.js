import {Body, Bodies, Composite, Vertices} from 'matter-js';

export function replace_body(world, outgoing, incomings) {
	const group = Composite.create();
	let max_area = -Infinity, argmax = null;
	for(const incoming of incomings) {
		// const centroid = Vector.mult(incoming.reduce((a, v) => Vector.add(a, v)), 1 / incoming.length);
		// never inherit position and angle because these will over-transform the points into a useless frame
		Body.setStatic(incoming, false);
		Body.setVelocity(incoming, outgoing.velocity)
		Body.setAngularVelocity(incoming, outgoing.angularVelocity);
		
		if(incoming.area > max_area) {
			max_area = incoming.area; argmax = incoming;
		}
		
		Composite.addBody(group, incoming);
	}
	Body.setStatic(argmax, true);
	// note: we assume the incoming bodies are centered at 0 and unrotated
	Composite.rotate(group, outgoing.angle, {x: 0, y: 0});
	Composite.translate(group, outgoing.position);
	Composite.addComposite(world, group);
	Composite.remove(world, outgoing, true); // look out for a memory leak of Composites! :S
}
export function poly_to_body(p) {
	const C = Vertices.centre(p);
	return Bodies.fromVertices(C.x, C.y, p, {}, false, false);
}