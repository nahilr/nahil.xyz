import type { AstroIntegration } from 'astro'

const peleIntegration = (): AstroIntegration => ({
  name: 'pele',
  hooks: {
    'astro:config:setup': ({ injectScript }) => {
      injectScript(
        'page',
        `import { mountAsync } from 'pele/lazy';
import katex from 'katex';
import { Icons } from '@/libs/icons';

const resolveIcon = (name) => {
  const iconName = name.includes(':') ? name.slice(name.lastIndexOf(':') + 1) : name;
  const paths = Icons[iconName];
  return paths ? '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">' + paths + '</svg>' : undefined;
};

const resolveMath = (tex, size) => {
  try {
    const html = katex.renderToString(tex, { output: 'htmlAndMathml', throwOnError: false, strict: 'ignore' });
    const measure = document.createElement('span');
    measure.style.cssText = 'position:fixed;left:-10000px;top:0;visibility:hidden;white-space:nowrap;font-size:' + size + 'px';
    measure.innerHTML = html;
    document.body.append(measure);
    const { width, height } = measure.getBoundingClientRect();
    measure.remove();
    return width && height ? { html, width, height } : null;
  } catch {
    return null;
  }
};

const peleOptions = {
  icons: resolveIcon,
  math: resolveMath,
  zoom: {
    always: false,
    maxScale: 4,
    controls: true,
    labels: {
      zoomIn: 'Zoom in',
      zoomOut: 'Zoom out',
      reset: 'Reset zoom'
    }
  }
};

const mountedDiagrams = new Set();
let navigationId = 0;

const renderDiagrams = () => {
  const currentNavigation = navigationId;

  document.querySelectorAll('pre.pele-diagram:not([data-pele-mounted])').forEach((element) => {
    element.dataset.peleMounted = 'true';
    let vaultLinks = {};
    try {
      vaultLinks = JSON.parse(element.dataset.vaultLinks ?? '{}');
    } catch {
      vaultLinks = {};
    }
    const options = {
      ...peleOptions,
      onRender: (result) => {
        result.links.forEach((link) => {
          if (!link.internal || !vaultLinks[link.href]) return;
          const linkElement = Array.from(element.querySelectorAll('[id]')).find((node) => node.id === link.id);
          linkElement?.setAttribute('href', vaultLinks[link.href]);
        });
      }
    };
    mountAsync(element, element.textContent ?? '', options).then((diagram) => {
      if (currentNavigation !== navigationId || !element.isConnected) {
        diagram.destroy();
        return;
      }
      mountedDiagrams.add(diagram);
    }).catch((error) => {
      element.dataset.peleError = 'true';
      element.textContent = error instanceof Error ? error.message : 'Unable to render diagram';
    });
  });
};

const destroyDiagrams = () => {
  navigationId += 1;
  mountedDiagrams.forEach((diagram) => diagram.destroy());
  mountedDiagrams.clear();
};

renderDiagrams();
document.addEventListener('astro:before-swap', destroyDiagrams);
document.addEventListener('astro:page-load', renderDiagrams);
`
      )
    }
  }
})

export default peleIntegration
