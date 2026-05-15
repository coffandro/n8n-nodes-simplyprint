import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { simplyprintCall } from './common/client';
import { authenticationProperty, SIMPLYPRINT_CREDENTIALS } from './common/authSelector';
import { allProperties } from './descriptions';
import {
	loadPrinters,
	loadQueueGroups,
	loadFiles,
	loadQueueItems,
	loadFilaments,
	loadTags,
	loadCustomFields,
	searchPrinters,
	searchFiles,
	searchFilaments,
	searchQueueItems,
} from './common/dropdowns';
import { toSubmissionArray } from './common/customFields';
import { normalizeStartOptions } from './common/startOptions';
import {
	applySimplify,
	simplifyPrinter,
	simplifyQueueItem,
	simplifyQueueGroup,
	simplifyPrintHistory,
	simplifyTag,
} from './common/simplify';

/**
 * Read a resourceLocator value (or a plain options/number parameter) as a
 * number. `extractValue: true` unwraps the `{ __rl: true, mode, value }`
 * shape used by `type: 'resourceLocator'` parameters.
 */
function getIdParam(ctx: IExecuteFunctions, name: string, itemIndex: number): number {
	const raw = ctx.getNodeParameter(name, itemIndex, '', { extractValue: true }) as
		| string
		| number;
	const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
	if (!Number.isFinite(n) || n <= 0) {
		throw new NodeOperationError(
			ctx.getNode(),
			`Parameter "${name}" must resolve to a positive integer (got ${JSON.stringify(raw)})`,
			{ itemIndex },
		);
	}
	return n;
}

function getFileIdParam(ctx: IExecuteFunctions, name: string, itemIndex: number): string {
	const raw = ctx.getNodeParameter(name, itemIndex, '', { extractValue: true }) as
		| string
		| number;
	const asString = String(raw ?? '').trim();
	if (!asString) {
		throw new NodeOperationError(ctx.getNode(), `Parameter "${name}" is required`, { itemIndex });
	}
	return asString;
}

export class SimplyPrint implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'SimplyPrint',
		name: 'simplyPrint',
		icon: 'file:simplyprint.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Monitor and control SimplyPrint print farms - printers, queue, files, filament',
		defaults: { name: 'SimplyPrint' },
		inputs: ['main'],
		outputs: ['main'],
		usableAsTool: true,
		credentials: SIMPLYPRINT_CREDENTIALS,
		properties: [authenticationProperty, ...allProperties],
	};

	methods = {
		loadOptions: {
			loadPrinters,
			loadQueueGroups,
			loadFiles,
			loadQueueItems,
			loadFilaments,
			loadTags,
			loadCustomFields,
		},
		listSearch: {
			searchPrinters,
			searchFiles,
			searchFilaments,
			searchQueueItems,
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const resource = this.getNodeParameter('resource', i) as string;
				const operation = this.getNodeParameter('operation', i) as string;

				let result: IDataObject | IDataObject[] | unknown;

				// -------------------- printer --------------------
				if (resource === 'printer') {
					if (operation === 'getAll') {
						// printers/Get GET caps page_size at 25; POST allows 100. Switch
						// to POST so big farms come back in fewer round-trips. Response
						// key is still `data` either way.
						const simplify = this.getNodeParameter('simplify', i, true) as boolean;
						const res = await simplyprintCall(this, {
							method: 'POST',
							path: 'printers/Get',
							body: { page: 1, page_size: 100 },
						});
						const raw = ((res as IDataObject).data ?? res) as IDataObject | IDataObject[];
						result = applySimplify(raw, simplify, simplifyPrinter);
					} else if (operation === 'get') {
						// Single-printer fetch: `pid` works in either scope on this
						// endpoint, but we use POST to match getAll for consistency.
						const simplify = this.getNodeParameter('simplify', i, true) as boolean;
						const printerId = getIdParam(this, 'printerId', i);
						const res = await simplyprintCall(this, {
							method: 'POST',
							path: 'printers/Get',
							qs: { pid: printerId },
						});
						const raw = ((res as IDataObject).data ?? res) as IDataObject | IDataObject[];
						result = applySimplify(raw, simplify, simplifyPrinter);
					} else if (operation === 'pause' || operation === 'resume' || operation === 'cancel') {
						const printerId = getIdParam(this, 'printerId', i);
						const actionPath = { pause: 'Pause', resume: 'Resume', cancel: 'Cancel' }[operation];
						const res = await simplyprintCall(this, {
							method: 'POST',
							path: `printers/actions/${actionPath}`,
							qs: { pid: printerId },
						});
						result = res;
					} else if (operation === 'sendGcode') {
						const printerId = getIdParam(this, 'printerId', i);
						const gcode = String(this.getNodeParameter('gcode', i, '') as string);
						const lines = gcode.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
						const res = await simplyprintCall(this, {
							method: 'POST',
							path: 'printers/actions/SendGcode',
							qs: { pid: printerId },
							body: { gcode: lines },
						});
						result = res;
					}
				}

				// -------------------- queue --------------------
				else if (resource === 'queue') {
					if (operation === 'getAll') {
						const simplify = this.getNodeParameter('simplify', i, true) as boolean;
						const groupId = this.getNodeParameter('groupId', i, 0) as number;
						const includeDone = this.getNodeParameter('includeDone', i, false) as boolean;
						const qs: IDataObject = {};
						if (groupId) qs.group = groupId;
						if (includeDone) qs.include_done = 1;
						const res = await simplyprintCall(this, { method: 'GET', path: 'queue/GetItems', qs });
						const raw = ((res as IDataObject).queue ?? (res as IDataObject).data ?? res) as
							| IDataObject
							| IDataObject[];
						result = applySimplify(raw, simplify, simplifyQueueItem);
					} else if (operation === 'getAllGroups') {
						const simplify = this.getNodeParameter('simplify', i, true) as boolean;
						const res = await simplyprintCall(this, { method: 'GET', path: 'queue/groups/Get' });
						const raw = ((res as IDataObject).list ?? (res as IDataObject).data ?? res) as
							| IDataObject
							| IDataObject[];
						result = applySimplify(raw, simplify, simplifyQueueGroup);
					} else if (operation === 'addItem') {
						// queue/AddItem accepts two file-id shapes:
						//   - `filesystem`: hex UID of a user-file already in the library
						//     (string). Matches `files/GetFiles` `uid` fields.
						//   - `fileId`: hex bucket-hash returned by `files/Upload` via
						//     files.simplyprint.io - a fresh upload that has not been
						//     persisted to a user-file row yet.
						// We surface both shapes through the `fileSource` selector.
						const fileSource = this.getNodeParameter(
							'fileSource',
							i,
							'userFile',
						) as string;
						const groupId = this.getNodeParameter('groupId', i, 0) as number;
						const amount = this.getNodeParameter('amount', i, 1) as number;
						const position = this.getNodeParameter('position', i, 'bottom') as string;
						const forPrintersRaw = this.getNodeParameter('forPrinters', i, '') as string;
						const forModelsRaw = this.getNodeParameter('forModels', i, '') as string;
						const forGroupsRaw = this.getNodeParameter('forGroups', i, '') as string;
						const tagIdsRaw = this.getNodeParameter('tagIds', i, '') as string;
						const customFieldsRaw = this.getNodeParameter('customFields', i, {}) as IDataObject;
						const customFields = toSubmissionArray(customFieldsRaw);

						const body: IDataObject = { amount, position };
						if (fileSource === 'uploadHash') {
							const hash = String(this.getNodeParameter('uploadFileId', i, '') as string).trim();
							if (!hash) {
								throw new NodeOperationError(
									this.getNode(),
									'queue.addItem requires an Upload Hash when File Source is "Upload Hash"',
									{ itemIndex: i },
								);
							}
							body.fileId = hash;
						} else {
							body.filesystem = getFileIdParam(this, 'fileId', i);
						}
						if (groupId) body.group = groupId;
						// for_printers / for_models / for_groups must be comma-separated
						// integer strings (not integer arrays) per the backend validator.
						if (forPrintersRaw.trim()) body.for_printers = forPrintersRaw.trim();
						if (forModelsRaw.trim()) body.for_models = forModelsRaw.trim();
						if (forGroupsRaw.trim()) body.for_groups = forGroupsRaw.trim();
						// Tags are an integer array.
						const tagIds = tagIdsRaw
							.split(',')
							.map((s) => Number(s.trim()))
							.filter((n) => Number.isFinite(n) && n > 0);
						if (tagIds.length > 0) body.tags = tagIds;
						if (customFields.length > 0) body.custom_fields = customFields;
						const res = await simplyprintCall(this, { method: 'POST', path: 'queue/AddItem', body });
						result = res;
					} else if (operation === 'updateItem') {
						// queue/UpdateItem reads `job` from $_GET (get_validation),
						// while `amount` and `note` belong in $_POST (post_validation).
						// Sending `job` in the body silently drops it and the request
						// fails further down at the RequireQueueItem helper.
						const queueItemId = getIdParam(this, 'queueItemId', i);
						const amount = this.getNodeParameter('amount', i, 1) as number;
						const note = this.getNodeParameter('note', i, '') as string;
						const body: IDataObject = { amount };
						if (note) body.note = note;
						const res = await simplyprintCall(this, {
							method: 'POST',
							path: 'queue/UpdateItem',
							qs: { job: queueItemId },
							body,
						});
						result = res;
					} else if (operation === 'moveItem') {
						// queue/MoveItem reads `jobs` (CSV; note plural) and `moveTo`
						// from $_GET. The legacy `body.{ job, to }` shape is silently
						// dropped at the validator.
						const queueItemId = getIdParam(this, 'queueItemId', i);
						const toPosition = this.getNodeParameter('toPosition', i) as number;
						const res = await simplyprintCall(this, {
							method: 'POST',
							path: 'queue/MoveItem',
							qs: { jobs: String(queueItemId), moveTo: toPosition },
						});
						result = res;
					} else if (operation === 'removeItem') {
						// queue/DeleteItem reads `job` (or `jobs` CSV) from $_GET.
						const queueItemId = getIdParam(this, 'queueItemId', i);
						await simplyprintCall(this, {
							method: 'POST',
							path: 'queue/DeleteItem',
							qs: { job: queueItemId },
						});
						result = { deleted: true };
					} else if (operation === 'reviveItem') {
						// queue/ReviveItem reads `job` from $_GET.
						const queueItemId = getIdParam(this, 'queueItemId', i);
						const res = await simplyprintCall(this, {
							method: 'POST',
							path: 'queue/ReviveItem',
							qs: { job: queueItemId },
						});
						result = res;
					} else if (operation === 'empty') {
						// queue/EmptyQueue post_validation: `group` (not `group_id`) and
						// `done_items` (not `include_done`). The 0.3.x shape was silently
						// no-opping; the toggle had never had any effect.
						const groupId = this.getNodeParameter('groupId', i, 0) as number;
						const includeDone = this.getNodeParameter('includeDone', i, false) as boolean;
						const body: IDataObject = {};
						if (groupId) body.group = groupId;
						if (includeDone) body.done_items = true;
						await simplyprintCall(this, {
							method: 'POST',
							path: 'queue/EmptyQueue',
							body,
						});
						result = { deleted: true };
					} else if (operation === 'getAllPending') {
						const simplify = this.getNodeParameter('simplify', i, true) as boolean;
						const res = await simplyprintCall(this, {
							method: 'GET',
							path: 'queue/approval/GetPendingItems',
						});
						const raw = ((res as IDataObject).items ?? (res as IDataObject).data ?? res) as
							| IDataObject
							| IDataObject[];
						result = applySimplify(raw, simplify, simplifyQueueItem);
					} else if (operation === 'approveItem' || operation === 'denyItem') {
						// queue/approval/{ApproveItem,DenyItem} read `jobs` (CSV) from
						// $_GET; only `comment` and (Deny only) `remove` go in the body.
						const ids = String(this.getNodeParameter('queueItemIds', i) as string)
							.split(',')
							.map((s) => Number(s.trim()))
							.filter((n) => Number.isFinite(n) && n > 0);
						if (ids.length === 0) {
							throw new NodeOperationError(
								this.getNode(),
								`queue.${operation} requires at least one queue item id`,
								{ itemIndex: i },
							);
						}
						const comment = this.getNodeParameter('comment', i, '') as string;
						const endpoint = operation === 'approveItem' ? 'ApproveItem' : 'DenyItem';
						const body: IDataObject = {};
						if (comment) body.comment = comment;
						if (operation === 'denyItem') {
							// Backend semantics: `remove:true` deletes the item, `remove:false`
							// keeps it as DENIED so the submitter can revise. Default is
							// "remove" (matches the 0.3.x assumption that deny = drop).
							const requestRevision = this.getNodeParameter(
								'requestRevision',
								i,
								false,
							) as boolean;
							body.remove = !requestRevision;
						}
						const res = await simplyprintCall(this, {
							method: 'POST',
							path: `queue/approval/${endpoint}`,
							qs: { jobs: ids.join(',') },
							body,
						});
						result = res;
					}
				}

				// -------------------- file --------------------
				else if (resource === 'file') {
					if (operation === 'getAll') {
						// files/GetFiles: f=-1 (all, flat), 0 (root), N (folder id).
						// Response has `files: [...]` + `folders: [...]` at top level.
						const folderId = this.getNodeParameter('folderId', i, -1) as number;
						const search = this.getNodeParameter('search', i, '') as string;
						const qs: IDataObject = { f: folderId };
						if (search) {
							qs.search = search;
							qs.global_search = true;
						}
						const res = await simplyprintCall(this, {
							method: 'GET',
							path: 'files/GetFiles',
							qs,
						});
						result = (res as IDataObject).files ?? (res as IDataObject).data ?? res;
					} else if (operation === 'upload') {
						// Upload via files.simplyprint.io (the integration-reachable
						// file upload service). Returns a string hex file id usable as
						// `fileId` on queue/AddItem or `file_id` on CreateJob.
						const binaryPropertyName = this.getNodeParameter(
							'binaryPropertyName',
							i,
							'data',
						) as string;
						const binaryData = this.helpers.assertBinaryData(i, binaryPropertyName);
						const buffer = await this.helpers.getBinaryDataBuffer(i, binaryPropertyName);
						const formData: IDataObject = {
							file: {
								value: buffer,
								options: {
									filename: binaryData.fileName ?? 'upload',
									contentType: binaryData.mimeType,
								},
							},
						};
						const res = await simplyprintCall<{
							file?: { id?: string; name?: string; size?: number; expires_at?: string };
						}>(this, {
							method: 'POST',
							path: 'files/Upload',
							formData,
							baseUrlOverride: 'https://files.simplyprint.io',
						});
						const file = (res as IDataObject).file as IDataObject | undefined;
						const fileId = String(file?.id ?? '');
						if (!fileId) {
							throw new NodeOperationError(
								this.getNode(),
								'files/Upload did not return a file id',
								{ itemIndex: i },
							);
						}
						result = {
							fileId,
							name: file?.name,
							size: file?.size,
							expires_at: file?.expires_at,
							raw: res,
						};
					} else if (operation === 'move') {
						// files/MoveFiles is a GET (not POST) with query params
						// `files` (comma-separated UID hex strings) + `folder` (int).
						const fileUids = String(this.getNodeParameter('fileUids', i) as string).trim();
						const targetFolder = this.getNodeParameter('targetFolderId', i, 0) as number;
						if (!fileUids) {
							throw new NodeOperationError(
								this.getNode(),
								'File > Move requires one or more file UIDs',
								{ itemIndex: i },
							);
						}
						const res = await simplyprintCall(this, {
							method: 'GET',
							path: 'files/MoveFiles',
							qs: { files: fileUids, folder: targetFolder },
						});
						result = res;
					}
				}

				// -------------------- filament --------------------
				else if (resource === 'filament') {
					if (operation === 'getAll') {
						// filament/GetFilament reads `compact` from $_POST only. Passing
						// it via query string lands in $_GET and is ignored, returning
						// the heavy panel-shape (filament dict keyed by id) instead of
						// the flat compact list. POST + compact:true yields a flat array
						// under `filament`.
						const res = await simplyprintCall<{
							filament?: IDataObject[] | Record<string, IDataObject>;
						}>(this, {
							method: 'POST',
							path: 'filament/GetFilament',
							body: { compact: true },
						});
						const f = res.filament;
						if (Array.isArray(f)) {
							result = f;
						} else if (f && typeof f === 'object') {
							// Defensive fallback: older deployments may still return the
							// dict shape. Normalise to array.
							result = Object.values(f);
						} else {
							result = [];
						}
					} else if (operation === 'get') {
						// filament/GetSpecific reads `id` (numeric) or `uid` (4-char
						// short id) from $_GET; sending `fid` was silently dropped.
						// Response key is `data` (not `filament`).
						const filamentId = getIdParam(this, 'filamentId', i);
						const res = await simplyprintCall(this, {
							method: 'GET',
							path: 'filament/GetSpecific',
							qs: { id: filamentId },
						});
						result = (res as IDataObject).data ?? (res as IDataObject).filament ?? res;
					} else if (operation === 'assign') {
						// filament/Assign uses RequirePrinter() + RequireFilaments()
						// which both default to reading from $_GET, so pid/fid travel
						// in the query string. The body's `filament[<fid>]` mapping
						// is the new-API shape: Assign.php's "old API" body.extruder
						// path only supports extruder (nozzle is hardcoded 0), so we
						// always emit the new shape to expose both. Single-nozzle
						// direct-drive printers leave both at 0 (the default).
						const filamentId = getIdParam(this, 'filamentId', i);
						const printerId = getIdParam(this, 'printerId', i);
						const nozzle = this.getNodeParameter('nozzle', i, 0) as number;
						const extruder = this.getNodeParameter('extruder', i, 0) as number;
						const res = await simplyprintCall(this, {
							method: 'POST',
							path: 'filament/Assign',
							qs: { pid: printerId, fid: filamentId },
							body: {
								filament: {
									[String(filamentId)]: { nozzle, extruder },
								},
							},
						});
						result = res;
					} else if (operation === 'unassign') {
						// filament/Unassign only needs the spool id; backend resolves
						// the printer from the spool's current assignment. Reads `fid`
						// from $_GET via RequireFilament().
						const filamentId = getIdParam(this, 'filamentId', i);
						const res = await simplyprintCall(this, {
							method: 'POST',
							path: 'filament/Unassign',
							qs: { fid: filamentId },
						});
						result = res;
					}
				}

				// -------------------- organization --------------------
				else if (resource === 'organization') {
					if (operation === 'getCurrentUser') {
						const res = await simplyprintCall(this, {
							method: 'GET',
							path: '0/account/GetUser',
							company: 0,
						});
						result = res;
					} else if (operation === 'getStatistics') {
						// account/GetStatistics is POST-only; validator requires
						// `general:true` OR a `start_date`/`end_date` pair
						// (required_unless:general,true). The 0.3.x GET-with-no-body
						// shape always failed validation and surfaced no data.
						// Response key is `statistics`, not `data`.
						const startDate = String(this.getNodeParameter('startDate', i, '') as string).trim();
						const endDate = String(this.getNodeParameter('endDate', i, '') as string).trim();
						const body: IDataObject =
							startDate && endDate
								? { start_date: startDate, end_date: endDate }
								: { general: true };
						const res = await simplyprintCall(this, {
							method: 'POST',
							path: 'account/GetStatistics',
							body,
						});
						result = (res as IDataObject).statistics ?? (res as IDataObject).data ?? res;
					} else if (operation === 'getAllPrintHistory') {
						// `print_history/Get` does not exist (404; there is no
						// `api/API/Endpoints/print_history/` directory). The actual
						// endpoint is `POST /jobs/GetPaginatedPrintJobs`, response
						// key `data`.
						const res = await simplyprintCall(this, {
							method: 'POST',
							path: 'jobs/GetPaginatedPrintJobs',
							body: { page: 1 },
						});
						const raw = ((res as IDataObject).data ?? res) as IDataObject | IDataObject[];
						result = applySimplify(raw, true, simplifyPrintHistory);
					} else if (operation === 'getAllTags') {
						// tags/Get returns { tags: [...] } on success. Accounts with no
						// tags respond with { status:false, message }; swallow that as [].
						try {
							const res = await simplyprintCall(this, { method: 'GET', path: 'tags/Get' });
							const raw = ((res as IDataObject).tags ?? (res as IDataObject).data ?? []) as
								| IDataObject
								| IDataObject[];
							result = applySimplify(raw, true, simplifyTag);
						} catch {
							result = [];
						}
					}
				}

				// -------------------- customField --------------------
				else if (resource === 'customField') {
					if (operation === 'getAll') {
						const res = await simplyprintCall(this, {
							method: 'GET',
							path: 'custom_fields/Get',
						});
						result = (res as IDataObject).data ?? res;
					} else if (operation === 'setValues') {
						const category = this.getNodeParameter('category', i, 'print') as string;
						const subCategory = this.getNodeParameter('subCategory', i, '') as string;
						const entityIds = String(this.getNodeParameter('entityIds', i) as string)
							.split(',')
							.map((s) => Number(s.trim()))
							.filter((n) => Number.isFinite(n) && n > 0);
						const valuesRaw = this.getNodeParameter('customFields', i, {}) as IDataObject;
						let values = toSubmissionArray(valuesRaw);

						// Back-compat shim: older flows saved a single `customFieldId` +
						// `value` (+ maybe `type`) rather than a fixedCollection. Synthesize
						// a one-entry array so they keep working.
						if (values.length === 0) {
							const legacyId = this.getNodeParameter('customFieldId', i, '') as string;
							const legacyValue = this.getNodeParameter('value', i, '') as string;
							if (legacyId) {
								values = toSubmissionArray({
									value: [{ customFieldId: String(legacyId), type: 'text', value: legacyValue }],
								} as IDataObject);
							}
						}

						const body: IDataObject = {
							category,
							entityIds,
							values: values as unknown as IDataObject[],
						};
						if (subCategory) body.subCategory = subCategory;

						const res = await simplyprintCall(this, {
							method: 'POST',
							path: 'custom_fields/SubmitValues',
							body,
						});
						result = res;
					}
				}

				// -------------------- printJob --------------------
				else if (resource === 'printJob') {
					if (operation === 'create') {
						const printerIdsRaw = this.getNodeParameter('printerIds', i) as string;
						const printerIds = printerIdsRaw
							.split(',')
							.map((s) => Number(s.trim()))
							.filter((n) => Number.isFinite(n) && n > 0);
						if (printerIds.length === 0) {
							throw new NodeOperationError(
								this.getNode(),
								'printJob.create requires at least one printer ID',
								{ itemIndex: i },
							);
						}
						const fileSource = this.getNodeParameter('fileSource', i, 'userFile') as string;
						const sharedRaw = this.getNodeParameter('customFields', i, {}) as IDataObject;
						const sharedCustomFields = toSubmissionArray(sharedRaw);
						const individualRaw = this.getNodeParameter('individualCustomFields', i, '[]') as
							| string
							| IDataObject
							| unknown[];
						const startOptionsRaw = this.getNodeParameter('startOptions', i, '{}') as
							| string
							| IDataObject;
						const mmsMapRaw = this.getNodeParameter('mmsMap', i, '{}') as string | IDataObject;

						const body: IDataObject = {};

						if (fileSource === 'userFile') {
							const fileId = getFileIdParam(this, 'fileId', i);
							body.filesystem = fileId;
						} else if (fileSource === 'queueItem') {
							const queueItemId = getIdParam(this, 'queueItemId', i);
							body.queue_file = queueItemId;
						}

						if (sharedCustomFields.length > 0) {
							body.custom_fields = sharedCustomFields as unknown as IDataObject[];
						}

						let individual: unknown = individualRaw;
						if (typeof individual === 'string') {
							const trimmed = individual.trim();
							if (trimmed.length > 0) {
								try {
									individual = JSON.parse(trimmed);
								} catch {
									throw new NodeOperationError(
										this.getNode(),
										'individualCustomFields is not valid JSON',
										{ itemIndex: i },
									);
								}
							} else {
								individual = [];
							}
						}
						if (Array.isArray(individual) && individual.length > 0) {
							body.individual_custom_fields = individual as IDataObject[];
						}

						const startOptions = normalizeStartOptions(startOptionsRaw);
						if (startOptions) body.start_options = startOptions;

						let mmsMap: unknown = mmsMapRaw;
						if (typeof mmsMap === 'string') {
							const trimmed = mmsMap.trim();
							if (trimmed.length > 0) {
								try {
									mmsMap = JSON.parse(trimmed);
								} catch {
									throw new NodeOperationError(
										this.getNode(),
										'mmsMap is not valid JSON',
										{ itemIndex: i },
									);
								}
							} else {
								mmsMap = {};
							}
						}
						if (
							mmsMap &&
							typeof mmsMap === 'object' &&
							Object.keys(mmsMap as IDataObject).length > 0
						) {
							body.mms_map = mmsMap as IDataObject;
						}

						// printers/actions/CreateJob calls RequirePrinters(self::POST, ...)
						// printer ids are read from the body only. The 0.3.x query
						// param landed in $_GET and was silently dropped.
						body.pid = printerIds.join(',');
						const res = await simplyprintCall(this, {
							method: 'POST',
							path: 'printers/actions/CreateJob',
							body,
						});
						result = res;
					}
				}

				// -------------------- customApiCall (escape hatch) --------------------
				else if (resource === 'customApiCall') {
					const method = this.getNodeParameter('method', i) as IHttpRequestMethods;
					const path = String(this.getNodeParameter('path', i) as string).replace(/^\/+/, '');
					const qsRaw = this.getNodeParameter('queryParams', i, {}) as IDataObject | string;
					const bodyRaw = this.getNodeParameter('body', i, {}) as IDataObject | string;
					const useCompany = this.getNodeParameter('useCompany', i, true) as boolean;

					const qs =
						typeof qsRaw === 'string' ? (JSON.parse(qsRaw || '{}') as IDataObject) : qsRaw;
					const body =
						typeof bodyRaw === 'string'
							? (JSON.parse(bodyRaw || '{}') as IDataObject)
							: bodyRaw;

					const res = await simplyprintCall(this, {
						method,
						path,
						qs: Object.keys(qs).length ? qs : undefined,
						body: method === 'GET' || Object.keys(body).length === 0 ? undefined : body,
						company: useCompany ? undefined : 0,
					});
					result = res;
				}

				// Flatten array results into one item per row, objects as a single item.
				if (Array.isArray(result)) {
					for (const row of result) {
						returnData.push({ json: row as IDataObject, pairedItem: { item: i } });
					}
				} else {
					returnData.push({ json: (result ?? {}) as IDataObject, pairedItem: { item: i } });
				}
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: (error as Error).message },
						pairedItem: { item: i },
					});
					continue;
				}
				throw error;
			}
		}

		return [returnData];
	}
}
