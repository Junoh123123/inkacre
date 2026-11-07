import { createContext } from 'react';
import type { PropertyEntity, ViewConfig, ViewEntity } from '../data/types';

// Where the filter/sort chips write their changes. Database views save to the view (the default,
// `updateView`); the library keeps its filters and sorts in the browser and supplies its own columns
// as properties, so the same chips, editors and advanced filter work there.
export interface ViewEditor {
  update: (view: ViewEntity, config: Partial<ViewConfig>) => Promise<unknown>;
  schema?: PropertyEntity[];
}
export const ViewEditContext = createContext<ViewEditor | null>(null);
