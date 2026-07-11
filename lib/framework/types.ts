import React from 'react';

export interface InjectionConfig {
  id: string;
  selector: string | string[];
  insertAfterSelector?: string | string[];
  component: React.FC<{ doc: Document }>;
  alignment?: Partial<CSSStyleDeclaration>;
}
