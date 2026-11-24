import DocxReviewWorkspace from './DocxReviewWorkspace.jsx';
export { ROLE_OPTIONS, effectiveRole } from './A4PageSheet.jsx';

export default function StructurePreview(props) {
  return <DocxReviewWorkspace stage="review" {...props} />;
}
