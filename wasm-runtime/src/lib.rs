use wasm_bindgen::prelude::*;
use serde_json::json;

// Same library versions and defaults as Core release 0.5.5 native wrappers.
#[wasm_bindgen]
pub struct TextRuntime {
    light: Vec<u8>,
    regular: Vec<u8>,
    segmenter: icu_segmenter::LineSegmenterBorrowed<'static>,
}

#[wasm_bindgen]
impl TextRuntime {
    #[wasm_bindgen(constructor)]
    pub fn new(light: Vec<u8>, regular: Vec<u8>) -> Self {
        Self { light, regular, segmenter: icu_segmenter::LineSegmenter::new_auto(Default::default()) }
    }

    pub fn breaks(&self, text: &str) -> Vec<u32> {
        self.segmenter.segment_str(text)
            .map(|offset| text[..offset].encode_utf16().count() as u32).collect()
    }

    pub fn shape(&self, text: &str, weight: u32) -> Result<String, JsValue> {
        let bytes = if weight == 300 { &self.light } else { &self.regular };
        let face = rustybuzz::Face::from_slice(bytes, 0).ok_or_else(|| JsValue::from_str("Invalid font"))?;
        let mut buffer = rustybuzz::UnicodeBuffer::new();
        buffer.push_str(text);
        let shaped = rustybuzz::shape(&face, &[], buffer);
        let glyphs: Vec<_> = shaped.glyph_infos().iter().zip(shaped.glyph_positions()).map(|(info, pos)| {
            let ink = face.glyph_bounding_box(rustybuzz::ttf_parser::GlyphId(info.glyph_id as u16))
                .map(|b| json!({"xMin":b.x_min,"xMax":b.x_max,"yMin":b.y_min,"yMax":b.y_max}));
            json!({"glyphId":info.glyph_id,"cluster":info.cluster,"xAdvance":pos.x_advance,
                "yAdvance":pos.y_advance,"xOffset":pos.x_offset,"yOffset":pos.y_offset,"ink":ink})
        }).collect();
        Ok(json!({"shaperRevision":"rustybuzz-0.20.1","unitsPerEm":face.units_per_em(),
            "ascent":face.ascender(),"descent":face.descender(),"glyphs":glyphs}).to_string())
    }
}
