// All fresh topics into one JSON text for the writer's input file.
const topics = $input.all().map((i) => i.json);
return [{ json: { text: JSON.stringify({ topics }, null, 1), count: topics.length } }];
