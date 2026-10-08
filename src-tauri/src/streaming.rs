/// Decode complete SSE events without decoding partial UTF-8 network chunks.
#[derive(Default)]
pub(crate) struct SseDecoder {
    bytes: Vec<u8>,
    data: Vec<String>,
}

impl SseDecoder {
    pub(crate) fn push(&mut self, chunk: &[u8]) -> Result<Vec<String>, String> {
        self.bytes.extend_from_slice(chunk);
        let mut events = Vec::new();
        while let Some(pos) = self.bytes.iter().position(|b| *b == b'\n') {
            let line: Vec<u8> = self.bytes.drain(..=pos).collect();
            self.line(&line[..pos], &mut events)?;
        }
        if self.bytes.len() + self.data.iter().map(String::len).sum::<usize>() > 1024 * 1024 {
            return Err("SSE event exceeds 1 MiB".into());
        }
        Ok(events)
    }

    pub(crate) fn finish(&mut self) -> Result<Vec<String>, String> {
        let mut events = Vec::new();
        let remaining = std::mem::take(&mut self.bytes);
        if !remaining.is_empty() { self.line(&remaining, &mut events)?; }
        self.flush(&mut events);
        Ok(events)
    }

    fn line(&mut self, bytes: &[u8], events: &mut Vec<String>) -> Result<(), String> {
        let line = std::str::from_utf8(bytes).map_err(|e| format!("Invalid SSE UTF-8: {e}"))?;
        let line = line.strip_suffix('\r').unwrap_or(line);
        if line.is_empty() { self.flush(events); }
        else if let Some(data) = line.strip_prefix("data:") {
            self.data.push(data.strip_prefix(' ').unwrap_or(data).to_owned());
        }
        Ok(())
    }

    fn flush(&mut self, events: &mut Vec<String>) {
        if !self.data.is_empty() {
            events.push(self.data.join("\n"));
            self.data.clear();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_utf8_boundary_and_single_byte_chunks() {
        let input = "data: {\"text\":\"你好🌸\"}\r\n\r\ndata: [DONE]\n\n".as_bytes();
        let expected = vec!["{\"text\":\"你好🌸\"}", "[DONE]"];
        for split in 0..=input.len() {
            let mut decoder = SseDecoder::default();
            let mut events = decoder.push(&input[..split]).unwrap();
            events.extend(decoder.push(&input[split..]).unwrap());
            events.extend(decoder.finish().unwrap());
            assert_eq!(events, expected, "split at {split}");
        }
        let mut decoder = SseDecoder::default();
        let events: Vec<_> = input.iter().flat_map(|b| decoder.push(&[*b]).unwrap()).collect();
        assert_eq!(events, expected);
    }

    #[test]
    fn multiline_comments_and_unterminated_eof() {
        let mut decoder = SseDecoder::default();
        assert!(decoder.push(b": comment\nevent: message\ndata: first\ndata: second").unwrap().is_empty());
        assert_eq!(decoder.finish().unwrap(), vec!["first\nsecond"]);
        assert!(decoder.finish().unwrap().is_empty());
    }

    #[test]
    fn invalid_utf8_is_an_error_instead_of_replacement_text() {
        assert!(SseDecoder::default().push(b"data: \xff\n\n").is_err());
    }
}
