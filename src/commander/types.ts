import * as vscode from 'vscode';
import { PvfModel } from '../pvf/model';
import { PvfProvider } from '../pvf/provider';

export interface DecoApi {
  refreshAll: () => void;
  refreshUris: (uris: vscode.Uri[]) => void;
}

export interface Deps {
  model: PvfModel;
  tree: PvfProvider;
  deco: DecoApi;
  output: vscode.OutputChannel;
}
