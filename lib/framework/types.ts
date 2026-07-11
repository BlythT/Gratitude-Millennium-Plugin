import React from 'react';

export interface InjectionConfig<T = any> {
  id: string;
  selector: string | string[];
  insertAfterSelector?: string | string[];
  component: React.FC<{ data: T | null }>;
  alignment?: Partial<CSSStyleDeclaration>;
  observeData?: (doc: Document, onUpdate: (data: T | null) => void) => () => void;
  getDataAsync?: (doc: Document) => Promise<T | null>;
  getDataSync?: (doc: Document) => T | null;
}
