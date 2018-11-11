import {Vector} from 'matter-js';

export function world_body_coords(body, position) {
	return Vector.rotate(Vector.sub(position, body.position), -body.angle);
}
export function world_body_translated_coords(body, position) {
	return Vector.rotateAbout(position, -body.angle, body.position);
}
export function body_translated_body_coords(body, position) {
	return Vector.sub(position, body.position);
}
export function body_world_coords(body, position) {
	return Vector.add(Vector.rotate(position, body.angle), body.position);
}
export function body_translated_world_coords(body, position) {
	return Vector.rotateAbout(position, body.angle, body.position);
}