import {ProjectsIcon} from '@sanity/icons'
import {defineArrayMember, defineField, defineType} from 'sanity'

const apiVersion = '2026-11-07'

export const project = defineType({
  name: 'project',
  title: 'Project',
  type: 'document',
  icon: ProjectsIcon,
  description:
    'Portfolio project synced from Notion. Synced fields are replaced the next time that project is published.',
  fieldsets: [
    {
      name: 'sync',
      title: 'Sync',
      options: {collapsible: true, collapsed: true},
    },
  ],
  fields: [
    defineField({
      name: 'title',
      type: 'string',
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'slug',
      type: 'slug',
      options: {source: 'title'},
      validation: (rule) =>
        rule.required().custom(async (value, context) => {
          const slug = value?.current
          if (!slug) return 'A slug is required'
          if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
            return 'Use lowercase letters, numbers, and hyphens'
          }

          const client = context.getClient({apiVersion})
          const id = context.document?._id?.replace(/^drafts\./, '')
          const count = await client.fetch(
            `count(*[_type == "project" && slug.current == $slug && !(_id in path("drafts.**")) && _id != $id])`,
            {slug, id},
          )
          return count === 0 || 'This slug is already used by another project'
        }),
    }),
    defineField({
      name: 'portfolioStatus',
      title: 'Portfolio status',
      type: 'string',
      description: 'Controls whether the project is visible on the website.',
      initialValue: 'draft',
      options: {
        layout: 'radio',
        list: [
          {title: 'Draft', value: 'draft'},
          {title: 'Ready for review', value: 'readyForReview'},
          {title: 'Published', value: 'published'},
          {title: 'Unpublished', value: 'unpublished'},
        ],
      },
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'summary',
      type: 'text',
      rows: 3,
      description: 'Short text used on project cards.',
    }),
    defineField({
      name: 'description',
      type: 'text',
      rows: 3,
    }),
    defineField({
      name: 'objective',
      title: 'Objective',
      type: 'text',
      rows: 3,
    }),
    defineField({
      name: 'role',
      type: 'string',
      options: {
        list: [
          {title: 'Solo', value: 'Solo'},
          {title: 'Team Lead', value: 'Team Lead'},
          {title: 'Technology & Strategy Lead', value: 'Technology & Strategy Lead'},
        ],
      },
    }),
    defineField({
      name: 'disciplines',
      type: 'array',
      of: [defineArrayMember({type: 'string'})],
      options: {layout: 'tags'},
    }),
    defineField({
      name: 'tools',
      title: 'Tools',
      type: 'array',
      of: [defineArrayMember({type: 'string'})],
      options: {layout: 'tags'},
    }),
    defineField({
      name: 'deliverablesText',
      title: 'Deliverables',
      type: 'text',
      rows: 3,
    }),
    defineField({
      name: 'outcomesText',
      title: 'Outcomes',
      type: 'text',
      rows: 3,
    }),
    defineField({
      name: 'projectStatus',
      title: 'Project status',
      type: 'string',
      description: 'Delivery progress from Notion. This does not publish the project.',
      options: {
        list: [
          {title: 'Backlog', value: 'Backlog'},
          {title: 'Planning', value: 'Planning'},
          {title: 'In Progress', value: 'In Progress'},
          {title: 'Paused', value: 'Paused'},
          {title: 'Done', value: 'Done'},
          {title: 'Canceled', value: 'Canceled'},
        ],
      },
    }),
    defineField({
      name: 'startDate',
      title: 'Start date',
      type: 'date',
    }),
    defineField({
      name: 'endDate',
      title: 'End date',
      type: 'date',
    }),
    defineField({
      name: 'projectUrl',
      title: 'Project URL',
      type: 'url',
      validation: (rule) => rule.uri({scheme: ['http', 'https']}),
    }),
    defineField({
      name: 'mainImage',
      title: 'Hero image',
      type: 'image',
      options: {hotspot: true},
      fields: [
        defineField({
          name: 'alt',
          title: 'Alternative text',
          type: 'string',
          validation: (rule) => rule.required(),
        }),
      ],
    }),
    defineField({
      name: 'body',
      title: 'Case study',
      type: 'array',
      of: [
        defineArrayMember({type: 'block'}),
        defineArrayMember({
          type: 'image',
          options: {hotspot: true},
          fields: [
            defineField({
              name: 'alt',
              title: 'Alternative text',
              type: 'string',
            }),
          ],
        }),
      ],
    }),
    defineField({
      name: 'notionPageId',
      title: 'Notion page ID',
      type: 'string',
      fieldset: 'sync',
      readOnly: true,
      validation: (rule) =>
        rule.required().custom(async (value, context) => {
          if (!value) return true
          const client = context.getClient({apiVersion})
          const id = context.document?._id?.replace(/^drafts\./, '')
          const count = await client.fetch(
            `count(*[_type == "project" && notionPageId == $notionPageId && !(_id in path("drafts.**")) && _id != $id])`,
            {notionPageId: value, id},
          )
          return count === 0 || 'Another project is already synced from this Notion page'
        }),
    }),
    defineField({
      name: 'sourceUpdatedAt',
      title: 'Source updated',
      type: 'datetime',
      fieldset: 'sync',
      readOnly: true,
    }),
    defineField({
      name: 'lastSyncedAt',
      title: 'Last synced',
      type: 'datetime',
      fieldset: 'sync',
      readOnly: true,
    }),
  ],
  preview: {
    select: {
      title: 'title',
      subtitle: 'portfolioStatus',
      media: 'mainImage',
    },
  },
})
