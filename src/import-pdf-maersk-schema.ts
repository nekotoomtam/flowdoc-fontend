import type {Field, Schema} from './editor-structure';

export const maerskFieldGroups = {
  delivery: 'ใบสั่งปล่อยและเที่ยวเรือ',
  parties: 'คู่ค้า',
  cargo: 'สินค้าและตู้',
  notes: 'วันหมดอายุและการนับหน้า',
} as const;

export type MaerskField = {
  key: string;
  label: string;
  sourceLabel: string;
  group: keyof typeof maerskFieldGroups;
  definition?: Field;
  note?: string;
  disposition?: 'pending' | 'derived' | 'system' | 'blank';
};

function proposal(
  group: MaerskField['group'],
  key: string,
  label: string,
  sourceLabel: string,
  type: 'string' | 'number' = 'string',
): MaerskField {
  return {group, key, label, sourceLabel, definition: {type, label, required: false}};
}

function arrayProposal(key: string, label: string, sourceLabel: string, itemKey: string, itemLabel: string): MaerskField {
  return {
    group: 'cargo', key, label, sourceLabel,
    definition: {
      type: 'array', label, required: false,
      items: {type: 'object', fields: {[itemKey]: {type: 'string', label: itemLabel, required: true}}},
    },
  };
}

export const maerskFields: MaerskField[] = [
  proposal('delivery', 'bl_number', 'เลข B/L', 'BL No.'),
  proposal('delivery', 'vessel_name', 'ชื่อเรือ', 'Vessel'),
  proposal('delivery', 'voyage_number', 'เลขเที่ยวเรือ', 'Voy No.'),
  proposal('delivery', 'port_of_loading', 'ท่าต้นทาง', 'Port of Loading'),
  proposal('delivery', 'port_of_discharge', 'ท่าปลายทาง', 'Port of Discharge'),
  proposal('delivery', 'place_of_delivery', 'สถานที่ส่งมอบ', 'Place of delivery'),
  {...proposal('delivery', 'estimated_arrival_date', 'วันถึงตามต้นฉบับ', 'Estimate Time Arrival'),
    note: 'เก็บข้อความเดิมจนกว่าจะยืนยันรูปแบบวันและเดือน'},
  proposal('parties', 'consignee_details', 'ข้อมูลผู้รับสินค้า', 'Consignee (Complete Name and Address)'),
  proposal('parties', 'notify_party_details', 'ข้อมูลผู้รับแจ้ง', 'Notify Party (Complete Name and Address)'),
  proposal('parties', 'shipper_exporter_details', 'ข้อมูลผู้ส่งสินค้า', 'Shipper/Exporter (Complete Name and Address)'),
  {group: 'parties', key: 'party_country_code', label: 'รหัสประเทศคู่ค้า', sourceLabel: 'ข้อมูลในกล่องคู่ค้า', disposition: 'pending',
    note: 'ยังอยู่ในข้อมูลคู่ค้าต้นฉบับ ต้องยืนยันว่าจะแยกออกตามบทบาทอย่างไร'},
  {group: 'parties', key: 'party_tax_id', label: 'เลขประจำตัวผู้เสียภาษี', sourceLabel: 'TAX ID / TAX', disposition: 'pending',
    note: 'รอยืนยันการเก็บแยกตามบทบาท และเก็บเลขเป็นข้อความเพื่อรักษาเลขศูนย์นำหน้า'},
  {group: 'parties', key: 'party_contact_details', label: 'ข้อมูลติดต่อคู่ค้า', sourceLabel: 'TEL / FAX / MOBILE / Email', disposition: 'pending',
    note: 'รอแยกตามบทบาทจากกล่องคู่ค้า ข้อมูลติดต่อ Maersk ที่ท้ายแบบอยู่คนละส่วน'},
  proposal('cargo', 'shipping_marks', 'เครื่องหมายสินค้า', 'Marks and Numbers'),
  arrayProposal('container_numbers', 'เลขตู้สินค้า', 'Container No.', 'container_number', 'เลขตู้'),
  {group: 'cargo', key: 'listed_container_count', label: 'จำนวนเลขตู้ที่อ่านได้', sourceLabel: 'Container No.', disposition: 'derived',
    note: 'นับจากรายการเลขตู้ที่อ่านได้ รอยืนยันว่าจะใช้เป็นยอดรวมแยกหรือไม่'},
  proposal('cargo', 'package_count', 'จำนวนหีบห่อ', 'No. of Containers or pkgs', 'number'),
  proposal('cargo', 'package_type', 'หน่วยบรรจุ', 'No. of Containers or pkgs'),
  proposal('cargo', 'goods_description', 'คำอธิบายสินค้า', 'Kind of packages : description of goods'),
  arrayProposal('hs_codes', 'รหัส HS', 'HS CODE', 'hs_code', 'รหัส HS ตามต้นฉบับ'),
  proposal('cargo', 'onward_transit_text', 'ข้อความขนส่งต่อ', 'TO LAOS VIA / CARGO IN TRANSIT'),
  proposal('cargo', 'gross_weight_kg', 'น้ำหนักรวม (กก.)', 'Gross Weight', 'number'),
  proposal('cargo', 'cargo_volume_cbm', 'ปริมาตร (ลบ.ม.)', 'Measurement', 'number'),
  proposal('cargo', 'package_count_in_words', 'ยอดหีบห่อเป็นคำ', 'SAY'),
  {...proposal('notes', 'demurrage_expiry_date', 'วันหมดอายุ Demurrage', 'Demurrage will expire on'),
    disposition: 'blank', note: 'ต้นฉบับมีหัวช่อง ให้เว้นไว้เมื่อไม่มีวันที่'},
  {group: 'notes', key: 'printed_page_counter', label: 'เลขหน้าที่พิมพ์บนใบ', sourceLabel: 'Page 1 of 1', disposition: 'system',
    note: 'เป็นข้อมูลเลขหน้าจากต้นฉบับ การผูกตัวนับหน้าของ FlowDoc อยู่ในขั้นจัดโครง'},
];

export function sectionInputSchema(fields: ReadonlyArray<{field: MaerskField; label: string}>): Schema {
  return {
    type: 'object',
    fields: Object.fromEntries(fields.flatMap(({field, label}) =>
      field.definition ? [[field.key, {...field.definition, label: label.trim() || field.label}]] : [],
    )),
  };
}
