import type { OutboundMessage } from '@wa/workflow-engine';
import { prisma } from '../db';

export async function renderMenu(
  orgId: string,
  menuId: string,
  opts: { allowDraft?: boolean } = {},
): Promise<OutboundMessage | null> {
  const menu = await prisma.menu.findFirst({
    where: { id: menuId, organizationId: orgId, ...(opts.allowDraft ? {} : { isPublished: true }) },
    include: { options: { orderBy: { position: 'asc' } } },
  });
  if (!menu) return null;
  return {
    kind: 'menu',
    menuId: menu.id,
    header: menu.header || undefined,
    body: menu.body,
    buttonLabel: menu.buttonLabel,
    options: menu.options.map((o) => ({ id: o.id, title: o.title, description: o.description || undefined })),
  };
}

/**
 * Maps a customer's reply to a menu option: the interactive reply id (Cloud API),
 * the option number ("2"), or the option title.
 */
export async function resolveMenuSelection(
  orgId: string,
  menuId: string,
  text: string,
  interactiveReplyId?: string,
) {
  const menu = await prisma.menu.findFirst({
    where: { id: menuId, organizationId: orgId },
    include: { options: { orderBy: { position: 'asc' } } },
  });
  if (!menu) return null;
  const t = text.trim().toLowerCase();
  const byId = interactiveReplyId ? menu.options.find((o) => o.id === interactiveReplyId) : undefined;
  const num = /^\d{1,2}$/.test(t) ? menu.options[Number(t) - 1] : undefined;
  const byTitle = menu.options.find((o) => o.title.toLowerCase() === t);
  const option = byId ?? num ?? byTitle;
  return option ? { menu, option } : null;
}
