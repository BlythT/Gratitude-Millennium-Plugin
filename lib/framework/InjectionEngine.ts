import React from 'react';
import ReactDOM from 'react-dom';
import { InjectionConfig } from './types';
import { choosePlacement, needsMove, type Placement } from './placement';
import { log, logError } from '../../../lib/logger';

interface InjectedNode {
  container: HTMLElement | null;
  reactRoot: any | null;
  teardownObserver: MutationObserver | null;
}

// How long to wait before trying to mount a component again after its mount threw
const MOUNT_RETRY_MS = 2000;

class InjectionEngine {
  private configs: InjectionConfig[] = [];
  private mainObserver: MutationObserver | null = null;
  private injectedNodes: Map<string, InjectedNode> = new Map();
  // Configs whose last mount threw, and when they may be tried again
  private retryAfter: Map<string, number> = new Map();

  register(config: InjectionConfig) {
    this.configs.push(config);
    log(`[InjectionEngine] Registered config: ${config.id}`);
  }

  start(doc: Document = document) {
    if (this.mainObserver) {
      this.mainObserver.disconnect();
    }

    // Sweep in the observer callback itself. It runs as a microtask right after Steam changes the
    // DOM, before the browser paints, so the component lands in the same frame as Steam's markup.
    // Deferring to requestAnimationFrame let Steam's row paint one or two frames before it.
    // Mutation records are already batched per callback, and a sweep with nothing to do is a few
    // selector lookups.
    this.mainObserver = new MutationObserver(() => {
      this.sweep(doc);
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
      if (existing.container && !existing.container.isConnected) {
         // Container was removed from DOM by Steam
         this.cleanupInjected(config.id, existing);
         this.injectedNodes.delete(config.id);
      } else {
         // Already injected. If it went to the end of the row because the anchor (Play Time)
         // wasn't drawn yet, move it after the anchor now that it is.
         if (existing.container && config.insertAfterSelector) {
           const parent = existing.container.parentElement;
           const anchor = parent ? this.detectElementMulti(parent, config.insertAfterSelector) : null;
           if (anchor && needsMove(existing.container, anchor)) {
             anchor.after(existing.container);
           }
         }
         return;
      }
    }

    const retryAt = this.retryAfter.get(config.id);
    if (retryAt !== undefined && Date.now() < retryAt) return;

    const containerParent = this.detectElementMulti(doc, config.selector);
    if (!containerParent) return;

    const anchor = config.insertAfterSelector
      ? this.detectElementMulti(containerParent, config.insertAfterSelector)
      : null;
    this.inject(config, choosePlacement(containerParent, anchor, !!config.insertAfterSelector), doc);
  }

  private inject(config: InjectionConfig, placement: Placement<HTMLElement>, doc: Document) {
    const row = placement.kind === 'append' ? placement.target : placement.target.parentElement;
    if (config.alignment && row) {
      Object.assign(row.style, config.alignment);
    }

    const container = doc.createElement('div');
    container.id = `injection-${config.id}`;
    container.style.display = 'contents';

    if (placement.kind === 'append') {
      placement.target.append(container);
    } else {
      placement.target.after(container);
    }
    
    // root.render on its own schedules the render for a later task, and right after a page change
    // Steam's UI keeps that task waiting 100ms or more, so the component popped in after the page.
    // flushSync renders it now, in the same task as its container, before the browser paints.
    let root: any;
    try {
      root = (ReactDOM as any).createRoot(container);
      const element = React.createElement(config.component, { doc });
      const flushSync = (ReactDOM as any).flushSync;
      if (typeof flushSync === 'function') {
        flushSync(() => root.render(element));
      } else {
        root.render(element);
      }
    } catch (error) {
      // Leave nothing behind, and wait before retrying: the sweep runs on every DOM change, so a
      // mount that keeps throwing would otherwise retry in a loop that never yields
      logError(`[InjectionEngine] Mounting ${config.id} failed; retrying in ${MOUNT_RETRY_MS}ms:`, error);
      try { root?.unmount(); } catch { /* already broken */ }
      container.remove();
      this.retryAfter.set(config.id, Date.now() + MOUNT_RETRY_MS);
      return;
    }
    this.retryAfter.delete(config.id);

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

    this.injectedNodes.set(config.id, { container, reactRoot: root, teardownObserver });
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
