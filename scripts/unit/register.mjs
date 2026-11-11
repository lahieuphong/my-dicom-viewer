// Loaded with `node --import` before the unit tests; see loader.mjs.
import { register } from 'node:module';

register('./loader.mjs', import.meta.url);
