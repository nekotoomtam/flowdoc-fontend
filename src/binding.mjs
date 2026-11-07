export function applyMenuEdit(request, target, value) {
  const copy = structuredClone(request);
  const section = copy.sections.find(item => item.instanceKey === target.instanceKey);
  const occurrence = section?.data.parts[target.entry];
  const member = occurrence?.data.groups[target.group]?.members[target.member];
  if (occurrence?.format !== 'summary-dynamic' || !member) {
    throw new Error('The selected UAT data owner is missing');
  }
  member.menu = value;
  return copy;
}
