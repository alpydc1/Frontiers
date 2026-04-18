async function createInitialHelpMenu() {
    const commandsPath = path.join(__dirname, "../../commands");
    const categoryDirs = (
        await fs.readdir(commandsPath, { withFileTypes: true })
    )
        .filter((dirent) => dirent.isDirectory())
        .map((dirent) => dirent.name)
        .sort();

    const options = [
        {
            label: "📋 All Commands",
            description: "View every available command",
            value: ALL_COMMANDS_ID,
        },
        ...categoryDirs.map((category) => {
            const categoryName =
                category.charAt(0).toUpperCase() +
                category.slice(1).toLowerCase();
            const icon = CATEGORY_ICONS[categoryName] || "🔹";
            return {
                label: `${icon} ${categoryName}`,
                description: `Open ${categoryName} commands`,
                value: category,
            };
        }),
    ];

    // 🔥 MAIN EMBED (Dashboard Style)
    const embed = createEmbed({
        title: "⚡ Frontiers Dashboard",
        description:
            "Control your server with a **modern all-in-one system**.\n" +
            "Everything you need is organized below.\n\n" +
            "```Select a category to begin```",
        color: "primary",
    });

    embed.addFields(
        {
            name: "🧭 Core",
            value: "🛡️ Moderation\n💰 Economy\n🎮 Fun\n📊 Leveling",
            inline: true,
        },
        {
            name: "⚙️ System",
            value: "🎫 Tickets\n👋 Welcome\n🎭 Roles\n🔢 Counters",
            inline: true,
        },
        {
            name: "🌐 Community",
            value: "👥 Community\n🎂 Birthdays\n🎉 Giveaways\n🔍 Search",
            inline: true,
        },
        {
            name: "🚀 Actions",
            value:
                "• View all commands\n" +
                "• Report bugs\n" +
                "• Get support instantly",
            inline: false,
        }
    );

    embed.setFooter({
        text: "Frontiers • Unified Command System",
    });
    embed.setTimestamp();

    // 🎯 SINGLE CLEAN BUTTON ROW
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(ALL_COMMANDS_ID)
            .setLabel("All Commands")
            .setStyle(ButtonStyle.Primary),

        new ButtonBuilder()
            .setCustomId(BUG_REPORT_BUTTON_ID)
            .setLabel("Bug")
            .setStyle(ButtonStyle.Danger),

        new ButtonBuilder()
            .setLabel("Support")
            .setURL("https://discord.com/channels/1481587512534106134/1486750183629783262")
            .setStyle(ButtonStyle.Link),

        new ButtonBuilder()
            .setLabel("Info")
            .setURL("https://discord.com/channels/1481587512534106134/1493875742910447636")
            .setStyle(ButtonStyle.Link)
    );

    // 📂 DROPDOWN
    const selectRow = createSelectMenu(
        CATEGORY_SELECT_ID,
        "Browse command categories...",
        options
    );

    return {
        embeds: [embed],
        components: [selectRow, row], // clean order
    };
}
