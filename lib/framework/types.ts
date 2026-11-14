import React from 'react';

export interface InjectionConfig {
  id: string;
  selector: string | string[];
  insertAfterSelector?: string | string[];
  component: React.FC<{ doc: Document }>;
  alignment?: Partial<CSSStyleDeclaration>;
  // What the component is showing, e.g. the open game. When it changes while the component is
  // still in the page (Big Picture reuses the same stats row between games), the component is
  // mounted afresh so it reads the new page.
  instanceKey?: (doc: Document) => string;
}
