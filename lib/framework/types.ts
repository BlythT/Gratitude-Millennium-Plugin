import React from 'react';

export interface InjectionConfig<T = any> {
  id: string;
  selector: string | string[];
  insertAfterSelector?: string | string[];
  component: React.FC<{ data: T | null }>;
  alignment?: Partial<CSSStyleDeclaration>;
  getData: (doc: Document) => T | null | Promise<T | null>;
}
