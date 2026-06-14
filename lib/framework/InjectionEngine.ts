import React from 'react';
import ReactDOM from 'react-dom';
import { InjectionConfig } from './types';
import { log, logError } from '../../../lib/logger';

interface InjectedNode {
  container: HTMLElement | null;
  reactRoot: any | null;
  teardownObserver: MutationObserver | null;
  isFetching: boolean;
}

class InjectionEngine {
  private configs: InjectionConfig[] = [];
  private mainObserver: MutationObserver | null = null;
  private isAnimationFramePending = false;
  private injectedNodes: Map<string, InjectedNode> = new Map();

  register(config: InjectionConfig) {
    this.configs.push(config);
    log(`[InjectionEngine] Registered config: ${config.id}`);
  }

  start(doc: Document = document) {
    if (this.mainObserver) {
      this.mainObserver.disconnect();
    }

    this.mainObserver = new MutationObserver(() => {
      if (this.isAnimationFramePending) return;
      this.isAnimationFramePending = true;
      requestAnimationFrame(() => {
        try {
          this.sweep(doc);
        } finally {
          this.isAnimationFramePending = false;
        }
      });
    });

    this.mainObserver.observe(doc.body, { childList: true, subtree: true });
    log('[InjectionEngine] Started observing document body.');
    this.sweep(doc);
  }

  stop() {
    if (this.mainObserver) {
      this.mainObserver.disconnect();
      this.mainObserver = null;
    }
    
    for (const [id, injected] of this.injectedNodes.entries()) {
      this.cleanupInjected(id, injected);
    }
    this.injectedNodes.clear();
    log('[InjectionEngine] Stopped and cleaned up.');
  }

  private sweep(doc: Document) {
    for (const config of this.configs) {
      this.processConfig(config, doc);
    }
  }

  private detectElementMulti(doc: Document | HTMLElement, selectors: string | string[]): HTMLElement | null {
    const selectorArray = Array.isArray(selectors) ? selectors : [selectors];
    for (const selector of selectorArray) {
      const elements = doc.querySelectorAll(selector);
      if (elements.length > 0) {
        return elements[elements.length - 1] as HTMLElement;
      }
    }
    return null;
  }

  private processConfig(config: InjectionConfig, doc: Document) {
    const existing = this.injectedNodes.get(config.id);
    
    if (existing) {
      if (existing.isFetching) {
        return; // Currently fetching async data
      }
      if (existing.container && !existing.container.isConnected) {
         // Container was removed from DOM by Steam
         this.cleanupInjected(config.id, existing);
         this.injectedNodes.delete(config.id);
      } else {
         return; // Already injected and connected
      }
    }

    const containerParent = this.detectElementMulti(doc, config.selector);
    if (!containerParent) return;

    let insertTarget = containerParent;
    if (config.insertAfterSelector) {
        const afterTarget = this.detectElementMulti(containerParent, config.insertAfterSelector);
        if (!afterTarget) return;
        insertTarget = afterTarget;
    }

    const syncData = config.getDataSync ? config.getDataSync(doc) : undefined;
    
    if (syncData !== undefined && syncData !== null) {
      this.inject(config, insertTarget, syncData, doc);
    } else {
      // Async path or intentional null
      this.injectedNodes.set(config.id, { container: null, reactRoot: null, teardownObserver: null, isFetching: true });
      
      config.getDataAsync(doc)
        .then(asyncData => {
           if (!insertTarget.isConnected) {
              this.injectedNodes.delete(config.id);
              return;
           }
           this.injectedNodes.delete(config.id);
           this.inject(config, insertTarget, asyncData, doc);
        })
        .catch(err => {
           this.injectedNodes.delete(config.id);
           logError(`[InjectionEngine] Error getting async data for ${config.id}:`, err);
        });
    }
  }

  private inject(config: InjectionConfig, target: HTMLElement, data: any, doc: Document) {
    if (this.injectedNodes.has(config.id)) return;
    
    if (config.alignment && target.parentElement) {
      Object.assign(target.parentElement.style, config.alignment);
    }

    const container = doc.createElement('div');
    container.id = `injection-${config.id}`;
    container.style.display = 'contents';
    
    target.after(container);
    
    const root = (ReactDOM as any).createRoot(container);
    root.render(React.createElement(config.component, { data }));

    const teardownObserver = new MutationObserver(() => {
      if (!container.isConnected) {
        const injected = this.injectedNodes.get(config.id);
        if (injected) {
          this.cleanupInjected(config.id, injected);
          this.injectedNodes.delete(config.id);
        }
      }
    });
    
    if (container.parentElement) {
       teardownObserver.observe(container.parentElement, { childList: true });
    }

    this.injectedNodes.set(config.id, { container, reactRoot: root, teardownObserver, isFetching: false });
    log(`[InjectionEngine] Injected component for ${config.id}`);
  }

  private cleanupInjected(id: string, injected: InjectedNode) {
    log(`[InjectionEngine] Cleaning up injected node ${id}`);
    if (injected.teardownObserver) {
      injected.teardownObserver.disconnect();
    }
    if (injected.reactRoot) {
      try {
        injected.reactRoot.unmount();
      } catch (e) {
        logError(`[InjectionEngine] Unmount error for ${id}:`, e);
      }
    }
    if (injected.container && injected.container.parentNode) {
      injected.container.remove();
    }
  }
}

export const injectionEngine = new InjectionEngine();
