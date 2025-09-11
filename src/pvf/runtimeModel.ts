import { PvfModel } from './model';

let _model: PvfModel | null = null;

export function setPvfModel(m: PvfModel) { _model = m; }
export function getPvfModel(): PvfModel | null { return _model; }
