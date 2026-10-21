//! 字体文件解析：度量、字形反向映射与码位稳定性检查。
//!
//! 中日韩字体通常把「康熙部首」等**兼容码位**与标准汉字映射到同一个
//! 字形。PDF 的 `ToUnicode` CMap 是「字形 → 码位」的反向映射，同一个
//! 字形只能对应一个码位——如果字体里兼容码位排在前面，导出的 PDF 里
//! `一` 的 `ToUnicode` 就会变成 `⼀`（U+2F00 康熙部首）。
//!
//! 字形看着一样，但**复制出来、再搜索都对不上**：用户从 PDF 里复制
//! 「一二」，粘到编辑器里得到的是「⼀⼆」。实测有 30% 的常用汉字会
//! 中招（`一` `二` `人` `八` `几` `十` …）。
//!
//! 因此加载 CJK 字体时要先做**码位稳定性检查**：按 `printpdf` 内部
//! 的同一套算法算出反向映射，看常用汉字是否原样落在映射里。不合格
//! 的字体直接跳过，换下一个候选。

use std::collections::HashMap;
use std::path::Path;

use owned_ttf_parser::{AsFaceRef, OwnedFace};

/// 用于检查码位稳定性的探针字：都是极易被兼容码位替换的常用字。
const STABILITY_PROBES: &[char] = &['一', '二', '中', '文', '人', '十'];

/// 一个字体文件的解析结果。
#[derive(Debug)]
pub(crate) struct FontFile {
    face: OwnedFace,
    units_per_em: u16,
}

impl FontFile {
    /// 读取字体文件并解析。返回字体原始字节（供 `printpdf` 嵌入）
    /// 与解析好的度量。
    pub(crate) fn load(path: &Path) -> Result<(Vec<u8>, Self), String> {
        let bytes = std::fs::read(path)
            .map_err(|e| format!("读取字体失败 {}: {}", path.display(), e))?;
        let face = OwnedFace::from_vec(bytes.clone(), 0)
            .map_err(|e| format!("解析字体失败 {}: {}", path.display(), e))?;
        let units_per_em = face.as_face_ref().units_per_em();
        Ok((bytes, Self { face, units_per_em }))
    }

    /// 文本在给定字号（pt）下的宽度（pt）。
    ///
    /// 字体里没有的字符按半个 em 估算——真实宽度无从得知，但半个 em
    /// 是拉丁字母的平均值，能让后续片段不至于严重错位。
    pub(crate) fn text_width_pt(&self, text: &str, size_pt: f32) -> f32 {
        let face = self.face.as_face_ref();
        let mut total: f32 = 0.0;
        for ch in text.chars() {
            let advance = face
                .glyph_index(ch)
                .and_then(|gid| face.glyph_hor_advance(gid))
                .unwrap_or(self.units_per_em / 2) as f32;
            total += advance;
        }
        total * size_pt / self.units_per_em as f32
    }

    /// 文本在给定字号（pt）下的宽度（mm）。
    pub(crate) fn text_width_mm(&self, text: &str, size_pt: f32) -> f32 {
        self.text_width_pt(text, size_pt) * 25.4 / 72.0
    }

    /// 「字形编号 → 码位」的反向映射。
    ///
    /// 这里**刻意复刻 `printpdf` 内置字体后端的算法**（遍历 unicode
    /// cmap 子表，同一字形取先到的码位），因为 PDF 的 `ToUnicode`
    /// CMap 正是由它生成的。先到的算码位——很多字体里排在前面的是
    /// 康熙部首那样的兼容码位，于是标准汉字被顶掉。
    fn reverse_map(&self) -> HashMap<u16, char> {
        let face = self.face.as_face_ref();
        let mut map: HashMap<u16, char> = HashMap::new();
        let Some(cmap) = face.tables().cmap else {
            return map;
        };
        for subtable in cmap.subtables.into_iter().filter(|s| s.is_unicode()) {
            subtable.codepoints(|code| {
                let Ok(ch) = char::try_from(code) else {
                    return;
                };
                let Some(idx) = subtable.glyph_index(code).filter(|i| i.0 > 0) else {
                    return;
                };
                map.entry(idx.0).or_insert(ch);
            });
        }
        map
    }

    /// 码位是否稳定——即常用汉字在反向映射里是否原样保留。
    ///
    /// 不稳定意味着导出 PDF 后这些字复制出来会变成兼容码位，
    /// 搜索也匹配不上。这种字体不适合用来渲染 CJK 文本。
    pub(crate) fn is_codepoint_stable(&self) -> bool {
        let map = self.reverse_map();
        let face = self.face.as_face_ref();
        STABILITY_PROBES.iter().all(|ch| {
            face.glyph_index(*ch)
                .map(|gid| map.get(&gid.0) == Some(ch))
                .unwrap_or(false)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn latin_font_maps_ascii() {
        let (regular, _) = crate::pdf::fonts::get_font_paths().expect("should resolve");
        let (_, file) = FontFile::load(&regular).expect("should load");
        assert!(file.reverse_map().values().any(|c| *c == 'A'));
        assert!(file.reverse_map().values().any(|c| *c == 'z'));
    }

    #[test]
    fn metrics_measure_text_width() {
        let (regular, _) = crate::pdf::fonts::get_font_paths().expect("should resolve");
        let (_, file) = FontFile::load(&regular).expect("should load");
        let narrow = file.text_width_pt("i", 12.0);
        let wide = file.text_width_pt("W", 12.0);
        assert!(wide > narrow, "W should be wider than i: {wide} vs {narrow}");
        assert!(file.text_width_pt("", 12.0).abs() < f32::EPSILON);
        assert!(file.text_width_pt("Hello world", 12.0) > wide);
        // pt → mm 换算。
        let pt = file.text_width_pt("Hello", 12.0);
        let mm = file.text_width_mm("Hello", 12.0);
        assert!((mm - pt * 25.4 / 72.0).abs() < 1e-3);
    }

    #[test]
    fn cjk_font_candidate_is_codepoint_stable() {
        // 选中的 CJK 字体必须码位稳定——否则 PDF 里 30% 的常用汉字
        // 复制出来会变成兼容码位。
        let Some((regular, _)) = crate::pdf::fonts::pick_cjk_font_paths() else {
            return; // 系统没有可用的 CJK 字体，跳过。
        };
        let (_, file) = FontFile::load(&regular).expect("should load");
        assert!(
            file.is_codepoint_stable(),
            "选中的 CJK 字体码位不稳定: {:?}",
            regular
        );
    }
}
