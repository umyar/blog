import { config, fields, collection } from '@keystatic/core';

export default config({
  storage:
    process.env.NODE_ENV === 'development'
      ? { kind: 'local' }
      : { kind: 'github', repo: 'umyar/umyar-blog' },
  collections: {
    posts: collection({
      label: 'Posts',
      slugField: 'slug',
      path: 'src/content/posts/*/',
      schema: {
        slug: fields.slug({ name: { label: 'Slug (shared across languages)' } }),
        date: fields.date({ label: 'Publish date' }),
        draft: fields.checkbox({ label: 'Draft', defaultValue: true }),
        tags: fields.array(fields.text({ label: 'Tag' }), {
          label: 'Tags',
          itemLabel: (props) => props.value,
        }),
        cover: fields.image({
          label: 'Cover image',
          directory: 'src/assets/posts',
          publicPath: '../../../assets/posts/',
        }),
        title: fields.object(
          {
            ru: fields.text({ label: 'Title RU' }),
            en: fields.text({ label: 'Title EN' }),
            pt: fields.text({ label: 'Title PT' }),
          },
          { label: 'Title' }
        ),
        excerpt: fields.object(
          {
            ru: fields.text({ label: 'Excerpt RU', multiline: true }),
            en: fields.text({ label: 'Excerpt EN', multiline: true }),
            pt: fields.text({ label: 'Excerpt PT', multiline: true }),
          },
          { label: 'Excerpt' }
        ),
        audio: fields.object(
          {
            ru: fields.url({ label: 'Audio URL RU' }),
            en: fields.url({ label: 'Audio URL EN' }),
            pt: fields.url({ label: 'Audio URL PT' }),
          },
          { label: 'Audio' }
        ),
        audioName: fields.text({
          label: 'Audio name (artist — track)',
          description: 'Shown as a credit under the player. Shared across languages.',
        }),
        audioMeta: fields.object(
          {
            ru: fields.text({ label: 'Audio meta RU', multiline: true }),
            en: fields.text({ label: 'Audio meta EN', multiline: true }),
            pt: fields.text({ label: 'Audio meta PT', multiline: true }),
          },
          {
            label: 'Audio meta text',
            description: 'Caption shown above the player (per language).',
          }
        ),
        body_ru: fields.markdoc({
          label: 'Body RU',
          options: {
            image: { directory: 'src/assets/posts', publicPath: '../../../assets/posts/' },
          },
        }),
        body_en: fields.markdoc({
          label: 'Body EN',
          options: {
            image: { directory: 'src/assets/posts', publicPath: '../../../assets/posts/' },
          },
        }),
        body_pt: fields.markdoc({
          label: 'Body PT',
          options: {
            image: { directory: 'src/assets/posts', publicPath: '../../../assets/posts/' },
          },
        }),
      },
    }),
  },
});
