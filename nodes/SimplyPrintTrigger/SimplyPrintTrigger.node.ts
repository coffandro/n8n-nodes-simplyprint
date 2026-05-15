import type {
	IDataObject,
	IHookFunctions,
	INodeType,
	INodeTypeDescription,
	ITriggerFunctions,
	ITriggerResponse,
	IWebhookFunctions,
	IWebhookResponseData,
} from 'n8n-workflow';

import { simplyprintCall } from '../SimplyPrint/common/client';
import {
	authenticationProperty,
	SIMPLYPRINT_CREDENTIALS,
} from '../SimplyPrint/common/authSelector';
import {
	generateWebhookSecret,
	verifySimplyprintSignature,
	extractSecretHeader,
} from '../SimplyPrint/common/signature';

/**
 * Each option's `value` is the SimplyPrint WebhookEvent string registered on
 * the webhook subscription; `action` is the imperative phrase n8n's Node
 * Creator uses to render a per-event card under the SimplyPrint integration.
 *
 * The `name` of this property MUST stay `event` - n8n's triggersCategory()
 * helper in useActionsGeneration.ts auto-expands properties named `event`
 * into virtual trigger entries, which is how the 60+ events appear under
 * the single SimplyPrint integration card in the UI.
 *
 * Source of truth: `ecosystem/app/Enums/WebhookEvent.php`. The full enum is
 * mirrored here — payload wrapper keys per event are documented inline so
 * downstream nodes know what `data.*` fields to reference.
 */
const EVENT_OPTIONS = [
	// ---------- Jobs ----------
	{
		name: 'Print Started',
		value: 'job.started',
		action: 'Print started',
		description: 'A print has just started on a printer (data: job, user, started_by)',
	},
	{
		name: 'Print Paused',
		value: 'job.paused',
		action: 'Print paused',
		description: 'An in-progress print was paused (data: job)',
	},
	{
		name: 'Print Resumed',
		value: 'job.resumed',
		action: 'Print resumed',
		description: 'A paused print was resumed (data: job)',
	},
	{
		name: 'Print Cancelled',
		value: 'job.cancelled',
		action: 'Print cancelled',
		description: 'A print was cancelled (data: job, user)',
	},
	{
		name: 'Print Finished',
		value: 'job.done',
		action: 'Print finished',
		description: 'A print completed successfully (data: job)',
	},
	{
		name: 'Print Failed',
		value: 'job.failed',
		action: 'Print failed',
		description: 'A print ended with failure status (data: job)',
	},
	{
		name: 'Bed Cleared',
		value: 'job.bed_cleared',
		action: 'Bed cleared',
		description: 'A printer bed was marked as cleared after a print',
	},
	{
		name: 'Objects Skipped',
		value: 'job.objects_skipped',
		action: 'Objects skipped',
		description: 'One or more objects in a multi-object print were skipped',
	},
	// ---------- Printer state ----------
	{
		name: 'Printer AutoPrint State Changed',
		value: 'printer.autoprint_state_changed',
		action: 'Printer AutoPrint state changed',
		description: 'A printer\'s AutoPrint enabled / paused / disabled state changed',
	},
	{
		name: 'Printer Nozzle Size Changed',
		value: 'printer.nozzle_size_changed',
		action: 'Printer nozzle size changed',
		description: 'The configured nozzle size on a printer was updated',
	},
	{
		name: 'Printer Material Changed',
		value: 'printer.material_changed',
		action: 'Printer material changed',
		description: 'The configured material on a printer was updated',
	},
	{
		name: 'Printer Custom Tag Assigned',
		value: 'printer.custom_tag_assigned',
		action: 'Printer custom tag assigned',
		description: 'A custom tag was attached to a printer',
	},
	{
		name: 'Printer Custom Tag Detached',
		value: 'printer.custom_tag_detached',
		action: 'Printer custom tag detached',
		description: 'A custom tag was removed from a printer',
	},
	{
		name: 'Printer Out-of-Order State Changed',
		value: 'printer.out_of_order_state_changed',
		action: 'Printer out-of-order state changed',
		description: 'A printer was put into or taken out of the "out of order" state',
	},
	{
		name: 'Printer AI State Changed',
		value: 'printer.ai_state_changed',
		action: 'Printer AI state changed',
		description: 'AI failure-detection was toggled on or off for a printer',
	},
	{
		name: 'AI Failure Detected',
		value: 'printer.ai_failure_detected',
		action: 'AI failure detected',
		description: 'SimplyPrint AI flagged an in-progress print as failing (data: job, image, failures)',
	},
	{
		name: 'AI Failure False Positive',
		value: 'printer.ai_failure_false_positive',
		action: 'AI failure false positive',
		description: 'A user marked a previous AI failure detection as a false positive',
	},
	{
		name: 'AutoPrint Max Cycles Reached',
		value: 'printer.autoprint_max_cycles',
		action: 'AutoPrint max cycles reached',
		description: 'A printer reached its configured AutoPrint cycle cap',
	},
	// ---------- Company / organization ----------
	{
		name: 'Company AutoPrint State Changed',
		value: 'company.autoprint_state_changed',
		action: 'Company AutoPrint state changed',
		description: 'AutoPrint was enabled or disabled account-wide',
	},
	{
		name: 'Organization User Signup',
		value: 'organization.user_signup',
		action: 'Organization user signup',
		description: 'A new user joined the organization',
	},
	{
		name: 'Organization User Pending',
		value: 'organization.user_pending',
		action: 'Organization user pending',
		description: 'A new user request is pending approval',
	},
	// ---------- Queue ----------
	{
		name: 'Queue Item Added',
		value: 'queue.add_item',
		action: 'Queue item added',
		description: 'A new item was added to the print queue (data: queue_item, user)',
	},
	{
		name: 'Queue Item Deleted',
		value: 'queue.delete_item',
		action: 'Queue item deleted',
		description: 'A queue item was removed (data: queue_item, user)',
	},
	{
		name: 'Queue Emptied',
		value: 'queue.empty_queue',
		action: 'Queue emptied',
		description: 'The queue (or a queue group) was emptied (data: user, group)',
	},
	{
		name: 'Queue Item Moved',
		value: 'queue.move_item',
		action: 'Queue item moved',
		description: 'A queue item was repositioned (data: queue_item, user)',
	},
	{
		name: 'Queue Item Revived',
		value: 'queue.revive_item',
		action: 'Queue item revived',
		description: 'A done queue item was brought back into the active queue',
	},
	{
		name: 'Queue Item Pending Approval',
		value: 'queue.item_pending_approval',
		action: 'Queue item pending approval',
		description: 'A queue item entered the pending-approval state (data: queue_item, user)',
	},
	{
		name: 'Queue Item Approved',
		value: 'queue.item_approved',
		action: 'Queue item approved',
		description: 'A pending queue item was approved (data: queue_item, approved_by)',
	},
	{
		name: 'Queue Item Denied',
		value: 'queue.item_denied',
		action: 'Queue item denied',
		description: 'A pending queue item was denied (data: queue_item, denied_by, reason, removed)',
	},
	// ---------- Filament ----------
	{
		name: 'Filament Created',
		value: 'filament.create',
		action: 'Filament created',
		description: 'A new filament spool was added to the inventory',
	},
	{
		name: 'Filament Updated',
		value: 'filament.update',
		action: 'Filament updated',
		description: 'An existing filament spool\'s fields were updated',
	},
	{
		name: 'Filament Deleted',
		value: 'filament.delete',
		action: 'Filament deleted',
		description: 'A filament spool was removed from the inventory',
	},
	{
		name: 'Filament Assigned',
		value: 'filament.assigned',
		action: 'Filament assigned',
		description: 'A filament spool was assigned to a printer (data: filament, printer, user, replaced_spool)',
	},
	{
		name: 'Filament Unassigned',
		value: 'filament.unassigned',
		action: 'Filament unassigned',
		description: 'A filament spool was removed from a printer (data: filament, printer, user)',
	},
	// ---------- Balance ----------
	{
		name: 'Balance Charged',
		value: 'balance.charged',
		action: 'Balance charged',
		description: 'The account balance was charged for a print or service',
	},
	{
		name: 'Balance Refunded',
		value: 'balance.refunded',
		action: 'Balance refunded',
		description: 'A previous balance charge was refunded',
	},
	{
		name: 'Balance Topped Up',
		value: 'balance.topped_up',
		action: 'Balance topped up',
		description: 'The account balance was topped up',
	},
	{
		name: 'Balance Adjusted',
		value: 'balance.adjusted',
		action: 'Balance adjusted',
		description: 'The account balance was manually adjusted',
	},
	// ---------- Quota ----------
	{
		name: 'Quota Request New',
		value: 'quota.request_new',
		action: 'Quota request new',
		description: 'A user requested more printing quota',
	},
	{
		name: 'Quota Request Resolved',
		value: 'quota.request_resolved',
		action: 'Quota request resolved',
		description: 'A quota request was approved or denied',
	},
	{
		name: 'Quota Adjusted',
		value: 'quota.adjusted',
		action: 'Quota adjusted',
		description: 'A user\'s printing quota was manually adjusted',
	},
	{
		name: 'Quota Reset',
		value: 'quota.reset',
		action: 'Quota reset',
		description: 'A user\'s printing quota was reset to its plan default',
	},
	// ---------- Maintenance ----------
	{
		name: 'Maintenance Job Created',
		value: 'maintenance.job_created',
		action: 'Maintenance job created',
		description: 'A scheduled or ad-hoc maintenance job was created',
	},
	{
		name: 'Maintenance Job Updated',
		value: 'maintenance.job_updated',
		action: 'Maintenance job updated',
		description: 'A maintenance job\'s fields were edited',
	},
	{
		name: 'Maintenance Job Started',
		value: 'maintenance.job_started',
		action: 'Maintenance job started',
		description: 'A maintenance job was started by a technician',
	},
	{
		name: 'Maintenance Job Completed',
		value: 'maintenance.job_completed',
		action: 'Maintenance job completed',
		description: 'A maintenance job was marked complete',
	},
	{
		name: 'Maintenance Job Cancelled',
		value: 'maintenance.job_cancelled',
		action: 'Maintenance job cancelled',
		description: 'A maintenance job was cancelled before completion',
	},
	{
		name: 'Maintenance Job Reopened',
		value: 'maintenance.job_reopened',
		action: 'Maintenance job reopened',
		description: 'A completed maintenance job was reopened',
	},
	{
		name: 'Maintenance Job Overdue',
		value: 'maintenance.job_overdue',
		action: 'Maintenance job overdue',
		description: 'A scheduled maintenance job passed its due date (data: job, printer, scheduled_date)',
	},
	{
		name: 'Maintenance Job Deleted',
		value: 'maintenance.job_deleted',
		action: 'Maintenance job deleted',
		description: 'A maintenance job was deleted',
	},
	{
		name: 'Maintenance Problem Reported',
		value: 'maintenance.problem_reported',
		action: 'Maintenance problem reported',
		description: 'A user reported a problem with a printer (data: problem, printer, user)',
	},
	{
		name: 'Maintenance Problem Resolved',
		value: 'maintenance.problem_resolved',
		action: 'Maintenance problem resolved',
		description: 'A previously reported printer problem was resolved',
	},
	{
		name: 'Maintenance Low Stock',
		value: 'maintenance.low_stock',
		action: 'Maintenance low stock',
		description: 'A maintenance spare part dropped below its low-stock threshold',
	},
	{
		name: 'Maintenance Task Completed',
		value: 'maintenance.task_completed',
		action: 'Maintenance task completed',
		description: 'A checklist task on a maintenance job was completed',
	},
	{
		name: 'Maintenance Task Skipped',
		value: 'maintenance.task_skipped',
		action: 'Maintenance task skipped',
		description: 'A checklist task on a maintenance job was skipped',
	},
	{
		name: 'Maintenance Schedule Created',
		value: 'maintenance.schedule_created',
		action: 'Maintenance schedule created',
		description: 'A new recurring maintenance schedule was created',
	},
	{
		name: 'Maintenance Schedule Updated',
		value: 'maintenance.schedule_updated',
		action: 'Maintenance schedule updated',
		description: 'A recurring maintenance schedule was edited',
	},
	{
		name: 'Maintenance Schedule Deleted',
		value: 'maintenance.schedule_deleted',
		action: 'Maintenance schedule deleted',
		description: 'A recurring maintenance schedule was deleted',
	},
	{
		name: 'Maintenance Spare Part Created',
		value: 'maintenance.spare_part_created',
		action: 'Maintenance spare part created',
		description: 'A spare part was added to the inventory',
	},
	{
		name: 'Maintenance Spare Part Updated',
		value: 'maintenance.spare_part_updated',
		action: 'Maintenance spare part updated',
		description: 'A spare part\'s details were updated',
	},
	{
		name: 'Maintenance Spare Part Deleted',
		value: 'maintenance.spare_part_deleted',
		action: 'Maintenance spare part deleted',
		description: 'A spare part was removed from the inventory',
	},
	{
		name: 'Maintenance Stock Adjusted',
		value: 'maintenance.stock_adjusted',
		action: 'Maintenance stock adjusted',
		description: 'Spare-part stock levels were adjusted',
	},
	// ---------- Test ----------
	{
		name: 'Test Webhook',
		value: 'test',
		action: 'Test webhook',
		description: 'Fired by the SimplyPrint panel when a user clicks "Send test" on a webhook',
	},
];

interface StoredWebhook extends IDataObject {
	webhookId?: number;
	secret?: string;
	event?: string;
}

export class SimplyPrintTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'SimplyPrint Trigger',
		name: 'simplyPrintTrigger',
		icon: 'file:simplyprint.svg',
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["event"]}}',
		description: 'Starts a workflow when SimplyPrint emits a selected event',
		defaults: { name: 'SimplyPrint Trigger' },
		inputs: [],
		outputs: ['main'],
		usableAsTool: true,
		credentials: SIMPLYPRINT_CREDENTIALS,
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				responseMode: 'onReceived',
				path: 'webhook',
			},
		],
		properties: [
			authenticationProperty,
			{
				displayName: 'Event',
				name: 'event',
				type: 'options',
				options: EVENT_OPTIONS,
				default: 'job.done',
				required: true,
				description: 'SimplyPrint event that starts this workflow',
			},
			{
				displayName:
					'When this workflow is active, n8n registers a dedicated SimplyPrint webhook for the selected event (and removes it when the workflow is deactivated). Every delivery is verified with a unique per-workflow secret.',
				name: 'notice',
				type: 'notice',
				default: '',
			},
		],
	};

	webhookMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				const webhookUrl = this.getNodeWebhookUrl('default');
				const workflowData = this.getWorkflowStaticData('node') as StoredWebhook;
				if (!workflowData.webhookId) return false;

				try {
					const res = await simplyprintCall<{ data?: Array<{ id: number; url?: string }> }>(
						this,
						{ method: 'GET', path: 'webhooks/Get' },
					);
					const hooks = res.data ?? [];
					const exists = hooks.some(
						(h) => h.id === workflowData.webhookId && (!h.url || h.url === webhookUrl),
					);
					if (!exists) {
						delete workflowData.webhookId;
						delete workflowData.secret;
						delete workflowData.event;
					}
					return exists;
				} catch {
					// If SimplyPrint is unreachable, assume present and let `create`
					// re-register on the next activation attempt.
					return true;
				}
			},

			async create(this: IHookFunctions): Promise<boolean> {
				const webhookUrl = this.getNodeWebhookUrl('default');
				if (!webhookUrl) return false;

				const event = this.getNodeParameter('event') as string;
				const eventMeta = EVENT_OPTIONS.find((o) => o.value === event);
				const eventLabel = eventMeta?.name ?? event;

				const secret = generateWebhookSecret();
				const res = await simplyprintCall<{ webhook?: { id: number } }>(this, {
					method: 'POST',
					path: 'webhooks/Create',
					body: {
						name: `n8n: ${eventLabel}`,
						description: `Auto-managed by n8n. Workflow-scoped webhook for the ${event} event - do not edit.`,
						url: webhookUrl,
						events: [event],
						secret,
						enabled: true,
					},
				});

				const webhookId = res.webhook?.id;
				if (!webhookId) return false;

				const workflowData = this.getWorkflowStaticData('node') as StoredWebhook;
				workflowData.webhookId = webhookId;
				workflowData.secret = secret;
				workflowData.event = event;
				return true;
			},

			async delete(this: IHookFunctions): Promise<boolean> {
				const workflowData = this.getWorkflowStaticData('node') as StoredWebhook;
				if (!workflowData.webhookId) return true;

				try {
					await simplyprintCall(this, {
						method: 'POST',
						path: 'webhooks/Delete',
						body: { id: workflowData.webhookId },
					});
				} catch {
					// Best effort - the webhook may already be gone (revoked app, panel delete).
				}
				delete workflowData.webhookId;
				delete workflowData.secret;
				delete workflowData.event;
				return true;
			},
		},
	};

	/**
	 * Called when the user clicks "Execute step" / "Listen for test event" in
	 * the editor. Returns a `manualTriggerFunction` that fetches a real sample
	 * payload from `webhooks/GetSamplePayload` so the user sees the true
	 * shape of the event body right away — no need to wait for a live delivery
	 * to round-trip through the webhook registration.
	 *
	 * The emitted shape is the full envelope a live POST would carry:
	 * `{ webhook_id, event, timestamp, data, source }`. `source` is `"real"`
	 * when the backend had a stored sample for this event and `"synthetic"`
	 * when it had to build one on the fly. Matches what `webhook()` returns
	 * on a live delivery, so the downstream workflow sees identical data in
	 * test-mode and prod-mode runs.
	 *
	 * n8n only runs this in manual/test mode. In activated (live) workflows
	 * the webhook registration in `webhookMethods.create` + the `webhook()`
	 * handler below do the actual work.
	 */
	async trigger(this: ITriggerFunctions): Promise<ITriggerResponse | undefined> {
		const event = this.getNodeParameter('event') as string;

		const manualTriggerFunction = async (): Promise<void> => {
			let sample: IDataObject | undefined;
			try {
				const res = await simplyprintCall<{
					samples?: Array<{
						webhook_id: number;
						event: string;
						timestamp: number;
						data: IDataObject;
						source?: string;
					}>;
				}>(this, {
					method: 'GET',
					path: 'webhooks/GetSamplePayload',
					qs: { event, limit: 1 },
				});
				sample = res.samples?.[0] as IDataObject | undefined;
			} catch {
				// Older SP instances, scope errors, or network failures fall
				// through to the synthetic fallback below rather than breaking
				// the "Execute step" flow.
			}

			if (!sample) {
				sample = {
					webhook_id: 0,
					event,
					timestamp: Math.floor(Date.now() / 1000),
					data: {},
					source: 'fallback',
				};
			}

			this.emit([this.helpers.returnJsonArray([sample])]);
		};

		return { manualTriggerFunction };
	}

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const headerData = this.getHeaderData() as Record<string, string | string[] | undefined>;
		const bodyData = this.getBodyData();
		const workflowData = this.getWorkflowStaticData('node') as StoredWebhook;

		const headerSecret = extractSecretHeader(headerData);
		if (!verifySimplyprintSignature(headerSecret, workflowData.secret)) {
			// Silent drop - forged, stale, or rotated secret.
			return { noWebhookResponse: true };
		}

		return {
			workflowData: [this.helpers.returnJsonArray([bodyData as IDataObject])],
		};
	}
}
