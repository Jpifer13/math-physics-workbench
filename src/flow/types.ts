import type { Edge, Node } from '@xyflow/react';
import type { ConstantData, FormulaData, Graph, NodeKind, OpData, OutputData, QuantityData } from '../core/graph';

export type Cfg = QuantityData | ConstantData | OpData | FormulaData | OutputData;
export type FNodeData = { kind: NodeKind; cfg: Cfg };
export type FNode = Node<FNodeData, 'phys'>;
export type FEdge = Edge;

/** Settings of the modeling panel: which output to chart against which input(s). */
export interface ModelCfg {
  outputId: string;
  xId: string;
  min: number;
  max: number;
  logX: boolean;
  logY: boolean;
  mode: 'curve' | 'map';
  yId: string;
  yMin: number;
  yMax: number;
}

export interface FlowDoc {
  name: string;
  description: string;
  nodes: FNode[];
  edges: FEdge[];
  model: ModelCfg;
}

export const emptyModel = (): ModelCfg => ({
  outputId: '', xId: '', min: 0, max: 10, logX: false, logY: false, mode: 'curve', yId: '', yMin: 0, yMax: 10,
});

export function toGraph(nodes: FNode[], edges: FEdge[]): Graph {
  return {
    nodes: nodes.map((n) => ({ id: n.id, kind: n.data.kind, data: n.data.cfg })),
    edges: edges.map((e) => ({ source: e.source, target: e.target, port: e.targetHandle ?? 'in' })),
  };
}
