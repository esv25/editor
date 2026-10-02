import { h, type SvgNode } from '../svg';

/** Show a figure as a see-through ghost (styled in diagram.css). */
export const toPreview = (node: SvgNode): SvgNode => h('g', { class: 'dg-ghost' }, [node]);
