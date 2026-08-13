import { invariant } from '../errors.js';
import { satisfiesRange } from '../version.js';

function descriptorCompatibility(descriptor, key) {
  return descriptor?.[`compatible${key[0].toUpperCase()}${key.slice(1)}`]
    || descriptor?.compatibility?.[key]
    || null;
}

export function assertRuntimeSet({ workflowVersion, workflowDescriptor, converterVersion, converterDescriptor, knowledgeVersion, knowledgeDescriptor, agentProtocolVersion } = {}) {
  const converterRange = descriptorCompatibility(workflowDescriptor, 'converter');
  if (converterRange && converterVersion) {
    invariant(satisfiesRange(converterVersion, converterRange), 'RUNTIME_VERSION_INCOMPATIBLE', `Workflow ${workflowVersion} is not compatible with Converter ${converterVersion}`, {
      workflowVersion, converterVersion, compatibleConverter: converterRange,
    });
  }
  const workflowRange = descriptorCompatibility(converterDescriptor, 'workflow');
  if (workflowRange && workflowVersion) {
    invariant(satisfiesRange(workflowVersion, workflowRange), 'RUNTIME_VERSION_INCOMPATIBLE', `Converter ${converterVersion} is not compatible with Workflow ${workflowVersion}`, {
      workflowVersion, converterVersion, compatibleWorkflow: workflowRange,
    });
  }
  if (!knowledgeDescriptor) return;
  const knowledgeWorkflowRange = descriptorCompatibility(knowledgeDescriptor, 'workflow');
  const knowledgeConverterRange = descriptorCompatibility(knowledgeDescriptor, 'converter');
  invariant(workflowVersion && satisfiesRange(workflowVersion, knowledgeWorkflowRange), 'RUNTIME_VERSION_INCOMPATIBLE', `Knowledge ${knowledgeVersion} is not compatible with Workflow ${workflowVersion}`, {
    knowledgeVersion, workflowVersion, compatibleWorkflow: knowledgeWorkflowRange,
  });
  invariant(converterVersion && satisfiesRange(converterVersion, knowledgeConverterRange), 'RUNTIME_VERSION_INCOMPATIBLE', `Knowledge ${knowledgeVersion} is not compatible with Converter ${converterVersion}`, {
    knowledgeVersion, converterVersion, compatibleConverter: knowledgeConverterRange,
  });
  const protocol = knowledgeDescriptor.compatibleAgentProtocol || knowledgeDescriptor.compatibility?.agentProtocol;
  invariant(protocol && Number.isSafeInteger(agentProtocolVersion) && agentProtocolVersion >= protocol.min && agentProtocolVersion <= protocol.max, 'RUNTIME_VERSION_INCOMPATIBLE', `Knowledge ${knowledgeVersion} is not compatible with Agent protocol ${agentProtocolVersion}`, {
    knowledgeVersion, agentProtocolVersion, compatibleAgentProtocol: protocol || null,
  });
}

export function runtimeSetFromCurrent(current, overrides = {}) {
  const workflowDescriptor = overrides.workflow || current.workflow;
  const converterDescriptor = overrides.converter || current.converter;
  const knowledgeDescriptor = overrides.knowledge || current.knowledge;
  return {
    workflowVersion: workflowDescriptor?.version || null,
    workflowDescriptor,
    converterVersion: converterDescriptor?.version || null,
    converterDescriptor,
    knowledgeVersion: knowledgeDescriptor?.version || null,
    knowledgeDescriptor,
    agentProtocolVersion: workflowDescriptor?.agentProtocolVersion || workflowDescriptor?.compatibility?.agentProtocolVersion || null,
  };
}
