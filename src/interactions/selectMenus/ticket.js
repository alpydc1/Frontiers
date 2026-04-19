import {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
} from 'discord.js';

const TYPE_CONFIG = {
  support: {
    label: 'General Support',
    placeholder: 'Describe your issue or question...',
  },
  content_creator: {
    label: 'Content Creator Application',
    placeholder: 'Tell us about yourself, your content, and why you want to apply...',
  },
  partnership: {
    label: 'Partnership Application',
    placeholder: 'Describe your server/community and what you are looking for in a partnership...',
  },
};

const ticketTypeSelectHandler = {
  name: 'ticket_type_select',
  async execute(interaction) {
    const selectedType = interaction.values[0];
    const typeConfig = TYPE_CONFIG[selectedType] || TYPE_CONFIG.support;

    const modal = new ModalBuilder()
      .setCustomId(`create_ticket_modal:${selectedType}`)
      .setTitle(`Create a Ticket — ${typeConfig.label}`);

    const reasonInput = new TextInputBuilder()
      .setCustomId('reason')
      .setLabel(`${typeConfig.label} — Details`)
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder(typeConfig.placeholder)
      .setRequired(true)
      .setMaxLength(1000);

    modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));

    await interaction.showModal(modal);
  },
};

export default [ticketTypeSelectHandler];
