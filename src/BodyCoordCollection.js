import {Map} from 'es6-shim';
import {centrify} from './Util/geom';

export default class {
	constructor() {
		this._map = new Map();
	}
	set(id, poly) {
		this._map.set(id, centrify(poly)); // just ensure they're centered
	}
	get(id) {
		return this._map.get(id);
	}
	delete(id) {
		return this._map.delete(id);
	}
	has(id) {
		return this._map.has(id);
	}
}