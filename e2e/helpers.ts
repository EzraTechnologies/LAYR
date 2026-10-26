import { expect, type Page } from '@playwright/test';

export const VIEWPORTS = [
  { name: '1024x600', width: 1024, height: 600 },
  { name: '800x480', width: 800, height: 480 },
] as const;

export const MIN_TOUCH = 44;

export interface LayoutProblem {
  kind: string;
  element: string;
  detail: string;
}

/**
 * Inspects the rendered page for layout defects: page-level overflow, elements outside the viewport,
 * text clipped without an ellipsis + title fallback, overflowing fixed-height cards, and small touch targets.
 */
export async function findLayoutProblems(page: Page): Promise<LayoutProblem[]> {
  return page.evaluate((minTouch) => {
    const problems: { kind: string; element: string; detail: string }[] = [];
    const describe = (el: Element) => {
      const cls = typeof el.className === 'string' && el.className ? `.${el.className.trim().split(/\s+/).join('.')}` : '';
      const text = (el.textContent ?? '').trim().slice(0, 40);
      return `${el.tagName.toLowerCase()}${cls} "${text}"`;
    };
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const doc = document.documentElement;

    if (doc.scrollWidth > vw || doc.scrollHeight > vh) {
      problems.push({ kind: 'page-overflow', element: 'html', detail: `${doc.scrollWidth}x${doc.scrollHeight}` });
    }

    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
    };

    /** True when the element sits inside a scroll container, so overflow there is reachable. */
    const inScroller = (el: Element) => {
      for (let p = el.parentElement; p; p = p.parentElement) {
        const o = getComputedStyle(p).overflowY;
        if ((o === 'auto' || o === 'scroll') && p.scrollHeight > p.clientHeight) return true;
      }
      return false;
    };

    for (const el of Array.from(document.querySelectorAll('#app *'))) {
      if (!visible(el) || el.closest('svg')) continue;
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);

      if (!inScroller(el) && (r.right > vw + 0.5 || r.bottom > vh + 0.5 || r.left < -0.5 || r.top < -0.5)) {
        problems.push({ kind: 'outside-viewport', element: describe(el), detail: `${r.left},${r.top} ${r.width}x${r.height}` });
      }

      const hasOwnText = Array.from(el.childNodes).some((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim());
      if (hasOwnText && el.scrollWidth > el.clientWidth + 1 && style.overflowX !== 'visible') {
        const ellipsis = style.textOverflow === 'ellipsis';
        const titled = !!(el as HTMLElement).title;
        if (!ellipsis || !titled) {
          problems.push({ kind: 'clipped-text', element: describe(el), detail: `${el.scrollWidth}>${el.clientWidth}` });
        }
      }

      if (
        el.classList.contains('card') &&
        style.overflowY === 'hidden' &&
        el.scrollHeight > el.clientHeight + 1
      ) {
        problems.push({ kind: 'card-overflow', element: describe(el), detail: `${el.scrollHeight}>${el.clientHeight}` });
      }

      if (el.matches('a[href], button, input, select, [role="radio"]')) {
        if (r.width < minTouch || r.height < minTouch) {
          problems.push({ kind: 'small-target', element: describe(el), detail: `${r.width}x${r.height}` });
        }
      }
    }
    return problems;
  }, MIN_TOUCH);
}

export async function expectCleanLayout(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  expect(await findLayoutProblems(page)).toEqual([]);
}
