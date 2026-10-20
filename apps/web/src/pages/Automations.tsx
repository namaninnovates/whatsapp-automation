import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, GitBranch, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { TRIGGER_LABELS, type TriggerType, type WorkflowDefinitionInput } from '@wa/shared';
import {
  Badge,
  Button,
  EmptyState,
  ErrorBlock,
  Field,
  IconButton,
  Input,
  LoadingBlock,
  Modal,
  PageHeader,
  Panel,
  Select,
  Toggle,
  useToast,
} from '../components/ui';
import { useAuth } from '../hooks/useAuth';
import { api, ApiError, errorMessage } from '../lib/api';
import type { WorkflowSummary } from '../lib/types';
import { timeAgo } from '../lib/utils';

const TEMPLATES: { id: string; name: string; description: string; definition: WorkflowDefinitionInput }[] = [
  {
    id: 'keyword',
    name: 'Keyword reply',
    description: 'Reply when a message contains a keyword.',
    definition: {
      trigger: { type: 'keyword', keywords: ['hours'], match: 'contains' },
      steps: [{ id: 'reply', type: 'send_text', text: 'We are open 10 am to 8 pm, Monday to Saturday.' }],
    },
  },
  {
    id: 'qualify',
    name: 'Lead qualification',
    description: 'Ask questions, save the answers and create a lead.',
    definition: {
      trigger: { type: 'keyword', keywords: ['quote', 'bulk'], match: 'contains' },
      steps: [
        {
          id: 'details',
          type: 'collect_details',
          fields: [
            { variable: 'company', prompt: 'What is your company name?' },
            { variable: 'quantity', prompt: 'How many units do you need?', validation: 'number' },
          ],
        },
        {
          id: 'lead',
          type: 'business_action',
          action: 'create_lead',
          params: { interest: '{{vars.quantity}} units for {{vars.company}}' },
        },
        { id: 'thanks', type: 'send_text', text: 'Thank you! Our team will send a quote shortly.' },
        { id: 'handoff', type: 'assign_human', note: 'New quote request' },
      ],
    },
  },
  {
    id: 'blank',
    name: 'Blank workflow',
    description: 'Start from an incoming-message trigger and one reply.',
    definition: {
      trigger: { type: 'incoming_message' },
      steps: [{ id: 'reply', type: 'send_text', text: 'Thanks for your message!' }],
    },
  },
];

export function AutomationsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const { can } = useAuth();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [template, setTemplate] = useState('keyword');
  const [confirmDelete, setConfirmDelete] = useState<WorkflowSummary | null>(null);
  const q = useQuery({ queryKey: ['workflows'], queryFn: () => api.get<WorkflowSummary[]>('/workflows') });
  const refresh = () => qc.invalidateQueries({ queryKey: ['workflows'] });

  const create = useMutation({
    mutationFn: () => {
      const t = TEMPLATES.find((x) => x.id === template)!;
      return api.post<{ id: string }>('/workflows', {
        name: name.trim() || t.name,
        description: t.description,
        definition: t.definition,
      });
    },
    onSuccess: (wf) => navigate(`/app/automations/${wf.id}`),
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const toggle = useMutation({
    mutationFn: (w: WorkflowSummary) =>
      api.post(`/workflows/${w.id}/${w.isActive ? 'deactivate' : 'activate'}`),
    onSuccess: (_d, w) => {
      toast(w.isActive ? `“${w.name}” deactivated` : `“${w.name}” is live`);
      refresh();
    },
    onError: (e) =>
      toast(
        e instanceof ApiError && Array.isArray(e.details)
          ? `${e.message}: ${(e.details as string[])[0]}`
          : errorMessage(e),
        'error',
      ),
  });
  const duplicate = useMutation({
    mutationFn: (id: string) => api.post(`/workflows/${id}/duplicate`),
    onSuccess: () => {
      toast('Workflow duplicated');
      refresh();
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/workflows/${id}`),
    onSuccess: () => {
      toast('Workflow deleted');
      setConfirmDelete(null);
      refresh();
    },
  });

  return (
    <div>
      <PageHeader
        title="Automations"
        description="Workflows run when their trigger matches an incoming message or business event. The most specific trigger wins."
        actions={
          can('ADMIN') && (
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
              New workflow
            </Button>
          )
        }
      />
      <div className="p-6">
        {q.isLoading && <LoadingBlock />}
        {q.error && <ErrorBlock error={q.error} />}
        {q.data && !q.data.length && (
          <Panel>
            <EmptyState
              icon={<GitBranch className="size-4" />}
              title="No workflows yet"
              action={
                can('ADMIN') && (
                  <Button variant="primary" onClick={() => setCreating(true)}>
                    Create a workflow
                  </Button>
                )
              }
            >
              Workflows answer messages, ask questions and run approved actions.
            </EmptyState>
          </Panel>
        )}
        {!!q.data?.length && (
          <Panel className="overflow-hidden">
            <table className="w-full text-left text-[13px]">
              <thead className="border-b border-line bg-subtle/60 text-[12px] text-ink-3">
                <tr>
                  <th className="px-4 py-2 font-medium">Workflow</th>
                  <th className="px-4 py-2 font-medium">Trigger</th>
                  <th className="px-4 py-2 font-medium">Runs (30 days)</th>
                  <th className="px-4 py-2 font-medium">Version</th>
                  <th className="px-4 py-2 font-medium">Active</th>
                  <th className="w-20 px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {q.data.map((w) => (
                  <tr key={w.id} className="hover:bg-subtle/40">
                    <td className="px-4 py-2.5">
                      <Link to={`/app/automations/${w.id}`} className="font-medium hover:underline">
                        {w.name}
                      </Link>
                      <p className="max-w-[46ch] truncate text-[12.5px] text-ink-3">{w.description || '—'}</p>
                    </td>
                    <td className="px-4 py-2.5 text-ink-2">
                      {TRIGGER_LABELS[w.triggerType as TriggerType] ?? w.triggerType}
                    </td>
                    <td className="px-4 py-2.5 tabular text-ink-2">
                      {w.stats30d.succeeded}
                      {w.stats30d.failed > 0 && (
                        <span className="ml-2 text-danger">{w.stats30d.failed} failed</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-ink-2">
                      v{w.latestVersion}
                      {w.isActive && !w.activeIsLatest && (
                        <Badge tone="warn" className="ml-2">
                          Draft changes
                        </Badge>
                      )}
                      <span className="block text-[12px] text-ink-3">{timeAgo(w.updatedAt)}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      <Toggle
                        label={`Activate ${w.name}`}
                        checked={w.isActive}
                        disabled={!can('ADMIN') || toggle.isPending}
                        onChange={() => toggle.mutate(w)}
                      />
                    </td>
                    <td className="px-4 py-2.5">
                      {can('ADMIN') && (
                        <div className="flex justify-end">
                          <IconButton label="Duplicate" onClick={() => duplicate.mutate(w.id)}>
                            <Copy className="size-3.5" />
                          </IconButton>
                          <IconButton label="Delete" onClick={() => setConfirmDelete(w)}>
                            <Trash2 className="size-3.5" />
                          </IconButton>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        )}
      </div>

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="New workflow"
        description="Start from a template; you can change everything in the builder."
        footer={
          <>
            <Button onClick={() => setCreating(false)}>Cancel</Button>
            <Button variant="primary" loading={create.isPending} onClick={() => create.mutate()}>
              Create
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Name" htmlFor="wf-name">
            <Input
              id="wf-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Delivery questions"
            />
          </Field>
          <Field label="Template" htmlFor="wf-template">
            <Select id="wf-template" value={template} onChange={(e) => setTemplate(e.target.value)}>
              {TEMPLATES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} — {t.description}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Modal>

      <Modal
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        title="Delete workflow?"
        description={`“${confirmDelete?.name}” and its run history will be removed. This cannot be undone.`}
        footer={
          <>
            <Button onClick={() => setConfirmDelete(null)}>Cancel</Button>
            <Button
              variant="danger"
              loading={remove.isPending}
              onClick={() => confirmDelete && remove.mutate(confirmDelete.id)}
            >
              Delete
            </Button>
          </>
        }
      >
        <p className="text-[13px] text-ink-2">Conversations keep their messages.</p>
      </Modal>
    </div>
  );
}
