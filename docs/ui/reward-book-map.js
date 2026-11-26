import { assetUrl } from './asset-url.js';
import { button, element } from './dom.js';
import { resourceIcon } from './resource-icon.js';

const svgNamespace = 'http://www.w3.org/2000/svg';

function keyAmount(className) {
  const node = element('span', className);
  const count = element('strong', 'reward-key-count');
  node.append(resourceIcon('key'), count);
  return { node, count };
}

export function createRewardMap(chapter, onSelect) {
  const { title, image, nodes } = chapter;
  const chart = element('div', 'reward-chart');
  chart.setAttribute('role', 'region');
  chart.setAttribute('aria-label', 'Маршруты · ' + title);
  const plot = element('div', 'reward-plot');
  plot.style.setProperty('--reward-map-image', `url('${assetUrl('./art/' + image)}')`);
  const edges = document.createElementNS(svgNamespace, 'svg');
  edges.setAttribute('class', 'reward-edges');
  edges.setAttribute('viewBox', '0 0 100 100');
  edges.setAttribute('preserveAspectRatio', 'none');
  edges.setAttribute('aria-hidden', 'true');
  const routes = document.createElementNS(svgNamespace, 'g');
  edges.append(routes);
  plot.append(edges);
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const nodeViews = nodes.map((node) => {
    const incoming = node.parents.map((id) => {
      const parent = nodesById.get(id);
      const edge = document.createElementNS(svgNamespace, 'line');
      edge.setAttribute('x1', parent.x);
      edge.setAttribute('y1', parent.y);
      edge.setAttribute('x2', node.x);
      edge.setAttribute('y2', node.y);
      edge.setAttribute('vector-effect', 'non-scaling-stroke');
      routes.append(edge);
      return { edge, parent };
    });
    const control = button(undefined, () => onSelect(node), 'reward-node');
    control.setAttribute('aria-haspopup', 'dialog');
    if (node.finale) control.dataset.finale = '';
    control.dataset.kind = node.kind;
    control.style.setProperty('--node-x', node.x + '%');
    control.style.setProperty('--node-y', node.y + '%');
    const price = keyAmount('reward-node-price');
    price.count.textContent = node.cost;
    price.node.setAttribute('aria-hidden', 'true');
    const mark = resourceIcon('check');
    mark.classList.add('reward-node-check');
    control.append(resourceIcon(node.kind), price.node, mark);
    plot.append(control);
    return { node, control, incoming };
  });
  chart.append(plot);
  return { chart, nodeViews };
}
